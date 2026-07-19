/**
 * Instagram Shopify Leads Scraper — main orchestration.
 *
 * Pipeline: discovery (search engines / hashtags / direct inputs)
 *   -> Instagram profile extraction (public API, HTML fallback)
 *   -> bio-link resolution (link-in-bio services)
 *   -> website platform detection (multi-signal Shopify detection)
 *   -> contact enrichment -> scoring -> filtering -> incremental dataset push.
 *
 * Leads are pushed to the dataset the moment their last pending request
 * finishes (tracked via `lead.pending`), so results stream in during the
 * run instead of appearing only at the end. Cross-account deduplication
 * happens at push time against already-pushed domain/email/name keys.
 *
 * HTTP-first: a single CheerioCrawler handles JSON APIs, search pages,
 * and websites. No browser is launched.
 */
import { Actor, log } from 'apify';
import { CheerioCrawler, sleep } from 'crawlee';

import { parseInput } from './input.js';
import {
    LABELS, IG_APP_ID, IG_PROFILE_URL, RUN_SUMMARY_KEY,
    GENERIC_HASHTAGS, HASHTAG_EXPAND_THRESHOLD, MAX_HASHTAG_EXPANSIONS,
    MAX_RELATED_PER_PROFILE, EXPANSION_MAX_FOLLOWERS,
    HISTORY_STORE_NAME, HISTORY_KEY,
} from './constants.js';
import {
    buildInitialRequests, profileRequest, hashtagRequest, buildHashtagFallbackRequests,
} from './discovery/index.js';
import { extractUsernamesFromSearchPage, nextSearchPageRequest } from './discovery/search-engine.js';
import { extractUsernamesFromHashtagResponse, isHashtagResponseBlocked } from './discovery/hashtag.js';
import { extractUsernamesFromTopsearch, isTopsearchBlocked } from './discovery/topsearch.js';
import {
    extractStoreCandidates, nextStoreSearchPageRequest, storeCandidatesFromUrls, matchesNiche,
} from './discovery/store-search.js';
import { extractLinksFromCse, nextGooglePageRequest } from './discovery/google-cse.js';
import {
    parseProfileApi, parseProfileHtml, usableExternalUrl, relatedUsernames,
} from './instagram/profile.js';
import { analyzeActivity } from './instagram/activity.js';
import { linkInBioService, extractOutboundLinks } from './website/bio-link.js';
import { detectPlatform, parseProductsJson, detectStoreIntelligence } from './platform-detection/detect.js';
import { extractContacts } from './contact-extraction/extract.js';
import { verifyEmailDomain } from './utils/email-verify.js';
import { createLead, buildRow, filterRow } from './leads.js';
import {
    normalizeDomain, canonicalUrl, stripTrackingParams, usernameFromInstagramUrl, unwrapRedirectUrl,
} from './utils/normalize.js';

await Actor.init();

const input = parseInput(await Actor.getInput());
log.info('Input parsed', {
    searchTerms: input.searchTerms.length,
    hashtags: input.hashtags.length,
    directProfiles: input.usernames.length,
    maxResults: input.maxResults,
    requireShopify: input.requireShopify,
    discoveryMode: input.discoveryMode,
    expandDiscovery: input.expandDiscovery,
});

const state = await Actor.useState('STATE', {
    leads: {},
    enqueuedProfiles: 0,
    // Shopify-first pipeline bookkeeping.
    storeDomains: {},
    enqueuedStores: 0,
    pushedCount: 0,
    errorRowsPushed: 0,
    // Dedup keys of already-pushed leads (value = primary username).
    pushedDomains: {},
    pushedEmails: {},
    pushedNames: {},
    hashtagCounts: {},
    expandedHashtags: {},
    // Instagram profile-API health tracking (401 blocks from datacenter IPs).
    apiBlocks: 0,
    apiOks: 0,
    htmlModeAnnounced: false,
    counters: {
        profilesDiscovered: 0,
        profilesProcessed: 0,
        profilesSkipped: 0,
        websitesInspected: 0,
        shopifyStoresFound: 0,
        failedRequests: 0,
        duplicatesRemoved: 0,
        leadsWithEmail: 0,
        highQualityLeads: 0,
        storeCandidatesChecked: 0,
        storeCandidatesRejected: 0,
        storeCandidatesOffTopic: 0,
        storesWithoutInstagram: 0,
        incompleteLeadsSkipped: 0,
        filteredOut: {
            followers: 0, notShopify: 0, noInstagram: 0, inactive: 0, noEmail: 0,
            belowMinScore: 0, excluded: 0, location: 0, previouslyExported: 0,
        },
    },
});
const { counters } = state;
// Guard against state persisted by an older code version.
counters.filteredOut.previouslyExported ??= 0;
counters.filteredOut.noInstagram ??= 0;
counters.storeCandidatesChecked ??= 0;
counters.storeCandidatesRejected ??= 0;
counters.storeCandidatesOffTopic ??= 0;
counters.storesWithoutInstagram ??= 0;
counters.incompleteLeadsSkipped ??= 0;

// Cross-run lead history (named store shared by all runs of this Actor).
// Always recorded; only filtered on when `skipPreviousLeads` is enabled.
const historyStore = await Actor.openKeyValueStore(HISTORY_STORE_NAME);
let exportedHistory = (await historyStore.getValue(HISTORY_KEY)) ?? {};
if (input.resetLeadsHistory && Object.keys(exportedHistory).length) {
    log.info(`Lead memory reset: forgot ${Object.keys(exportedHistory).length} remembered keys — `
        + 'previously exported businesses can appear again.');
    exportedHistory = {};
    await historyStore.setValue(HISTORY_KEY, exportedHistory);
}
let historyDirty = false;
async function persistHistory() {
    if (!historyDirty) return;
    historyDirty = false;
    await historyStore.setValue(HISTORY_KEY, exportedHistory);
}
Actor.on('persistState', () => persistHistory().catch(() => {}));

let proxyConfiguration;
try {
    proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
} catch (error) {
    log.warning(`Proxy configuration failed (${error.message}) — falling back to standard Apify Proxy.`);
    proxyConfiguration = await Actor.createProxyConfiguration({ useApifyProxy: true });
}

// ------------------------------------------------- lead lifecycle helpers

/**
 * True when the anonymous profile API is clearly blocked from the current
 * IP pool (blocks dominate successes) — from then on, new profiles go
 * straight to the HTML page, which still yields counts, bio, bio URL,
 * and bio email, and is throttled less aggressively.
 */
function instagramApiLooksBlocked() {
    return state.apiBlocks >= 15 && state.apiBlocks > state.apiOks * 5;
}

/** Register a newly discovered profile and enqueue its API request. */
async function enqueueProfile(crawler, username, source) {
    if (!username || state.leads[username]) return false;
    if (input.excludedUsernames.has(username)) return false;
    if (state.enqueuedProfiles >= input.discoveryCap) return false;
    if (state.pushedCount >= input.maxResults) return false;
    state.leads[username] = createLead(username, source);
    state.enqueuedProfiles += 1;
    counters.profilesDiscovered += 1;

    if (instagramApiLooksBlocked()) {
        if (!state.htmlModeAnnounced) {
            state.htmlModeAnnounced = true;
            log.warning('Instagram profile API is blocked from the current IP pool — '
                + 'switching new profiles to HTML pages (reduced data). '
                + 'Use RESIDENTIAL proxies or provide session cookies for full profile data.');
        }
        await crawler.addRequests([{
            url: IG_PROFILE_URL(username),
            label: LABELS.PROFILE_HTML,
            uniqueKey: `profilehtml:${username}`,
            userData: { label: LABELS.PROFILE_HTML, username, source },
        }]);
    } else {
        await crawler.addRequests([profileRequest(username, source)]);
    }
    return true;
}

/** Record that `count` more crawler requests belong to this lead. */
function trackLeadRequest(lead, count = 1) {
    lead.pending = (lead.pending ?? 0) + count;
}

/**
 * Push the lead's dataset row once ALL of its requests have finished.
 * Applies user filters and push-time deduplication (domain > email >
 * business name). Safe to call multiple times — pushes at most once.
 */
async function finalizeLead(lead, { force = false } = {}) {
    if (!lead || lead.finalized) return;
    if (!force && (lead.pending ?? 0) > 0) return;
    // 'pending' means the Instagram profile phase has not concluded yet
    // (store-side probes may finish first) — wait for a terminal status.
    if (!force && lead.status === 'pending') return;
    lead.finalized = true;

    if (!lead.profile) {
        // A lead discovered from the website side, with a verified store,
        // is a valid business lead even without Instagram profile data.
        const hasVerifiedStore = lead.websiteCandidates.some((c) => c.isShopify || c.hasOnlineStore);
        if (!hasVerifiedStore) {
            // Profiles the user explicitly asked for get an error row;
            // profiles we discovered ourselves are just counted as skipped.
            if (lead.source?.discoveryMethod === 'direct' && state.errorRowsPushed < 100) {
                state.errorRowsPushed += 1;
                await Actor.pushData(buildRow(lead, input));
            }
            return;
        }
        // Only note an error when there WAS an Instagram account to fetch.
        if (lead.username) {
            lead.error = lead.error ?? 'Instagram profile data unavailable (store verified from the website side)';
        }
    }
    if (lead.filterReason) {
        counters.filteredOut[lead.filterReason] += 1;
        return;
    }
    if (state.pushedCount >= input.maxResults) return;

    const row = buildRow(lead, input);
    const rejectedBy = filterRow(row, input);
    if (rejectedBy) {
        counters.filteredOut[rejectedBy] += 1;
        return;
    }

    // Quota worthiness: a row with no website, no contact info, and no
    // full profile data gives the user nothing to act on. Do not let such
    // rows consume the lead quota (explicit direct inputs are exempt, and
    // includeIncompleteLeads: true via API keeps everything).
    const isIncomplete = !row.resolvedStoreUrl && !row.publicEmail && !row.publicPhone
        && (!lead.profile || lead.profile.dataSource !== 'api');
    if (isIncomplete && !input.includeIncompleteLeads && lead.source?.discoveryMethod !== 'direct') {
        counters.incompleteLeadsSkipped += 1;
        return;
    }

    const domain = row.websiteDomain;
    const email = row.publicEmail ? row.publicEmail.toLowerCase() : null;
    const name = (row.fullName ?? '').trim().toLowerCase();

    // Cross-run dedup: skip businesses exported by any previous run.
    const historyKeys = [
        domain ? `d:${domain}` : null,
        email ? `e:${email}` : null,
        row.username ? `u:${row.username}` : null,
    ].filter(Boolean);
    if (input.skipPreviousLeads && historyKeys.some((key) => exportedHistory[key])) {
        counters.filteredOut.previouslyExported += 1;
        return;
    }

    const isDuplicate = (domain && state.pushedDomains[domain])
        || (email && state.pushedEmails[email])
        // Name-only dedup applies only when there is no domain/email to compare.
        || (!domain && !email && name.length >= 4 && state.pushedNames[name]);
    if (isDuplicate) {
        counters.duplicatesRemoved += 1;
        return;
    }
    if (domain) state.pushedDomains[domain] = row.username;
    if (email) state.pushedEmails[email] = row.username;
    if (!domain && !email && name.length >= 4) state.pushedNames[name] = row.username;

    // Deliverability signal: one cached DNS MX lookup per email domain.
    if (row.publicEmail) {
        row.emailVerified = await verifyEmailDomain(row.publicEmail);
    }

    await Actor.pushData(row);
    state.pushedCount += 1;
    if (row.publicEmail) counters.leadsWithEmail += 1;
    if (row.leadTier === 'High') counters.highQualityLeads += 1;

    const stamp = new Date().toISOString();
    for (const key of historyKeys) exportedHistory[key] = stamp;
    if (historyKeys.length) historyDirty = true;

    // Pay-per-event billing: no-ops unless the Actor is monetized (the
    // platform sets ACTOR_MAX_TOTAL_CHARGE_USD only on pay-per-event runs).
    if (process.env.ACTOR_MAX_TOTAL_CHARGE_USD) {
        try {
            await Actor.charge({ eventName: row.publicEmail ? 'lead-with-email' : 'lead' });
        } catch (error) {
            log.debug(`Charge event failed: ${error.message}`);
        }
    }
}

/** One of the lead's requests finished (success or final failure). */
async function completeLeadRequest(lead) {
    if (!lead) return;
    lead.pending = Math.max(0, (lead.pending ?? 0) - 1);
    await finalizeLead(lead);
}

/**
 * Shared continuation after profile extraction (API or HTML fallback):
 * apply the early follower filter, then move to the website phase or
 * finalize when there is no usable bio link.
 */
async function continueAfterProfile(crawler, lead) {
    const followers = lead.profile.followersCount;
    if (followers != null && (followers < input.minimumFollowers
        || (input.maximumFollowers > 0 && followers > input.maximumFollowers))) {
        lead.status = 'filtered';
        lead.filterReason = 'followers';
        await finalizeLead(lead);
        return;
    }

    const externalUrl = usableExternalUrl(lead.profile.externalUrl);

    // Shopify-first leads arrive with their store already verified from the
    // website side — no website phase needed, just record the bio URL.
    if (lead.websiteCandidates.some((c) => c.isShopify)) {
        lead.originalBioUrl = lead.originalBioUrl ?? externalUrl;
        lead.status = 'done';
        await finalizeLead(lead);
        return;
    }

    if (!externalUrl) {
        lead.status = 'no_website';
        await finalizeLead(lead);
        return;
    }

    lead.originalBioUrl = externalUrl;
    lead.status = 'website_pending';
    trackLeadRequest(lead);
    await crawler.addRequests([{
        url: externalUrl,
        label: LABELS.WEBSITE,
        uniqueKey: `web:${lead.username}:${canonicalUrl(externalUrl)}`,
        userData: { label: LABELS.WEBSITE, username: lead.username, depth: 0 },
    }]);
}

/**
 * Discovery auto-expansion: reach niche brands whose name/bio never
 * literally matches the keyword. Two public signals are used:
 *  1. Instagram's own "related profiles" suggestions on each profile.
 *  2. Hashtags that several discovered brands use in their recent posts
 *     (snowball via HASHTAG discovery, generic mega-tags excluded).
 * Bounded by the discovery cap and MAX_HASHTAG_EXPANSIONS.
 */
async function expandDiscoveryFrom(crawler, lead, user) {
    // Mega-brand accounts suggest other mega-brands (Garnier -> Pantene,
    // Twix, …) which are almost never Shopify SMB leads — skip expansion.
    const followers = lead.profile?.followersCount;
    if (followers != null && followers > EXPANSION_MAX_FOLLOWERS) {
        log.debug(`@${lead.username}: skipping discovery expansion (mega-brand, ${followers} followers)`);
        return;
    }

    for (const username of relatedUsernames(user).slice(0, MAX_RELATED_PER_PROFILE)) {
        await enqueueProfile(crawler, username, {
            discoveryMethod: 'related',
            searchTerm: lead.source?.searchTerm ?? null,
            locationQuery: lead.source?.locationQuery ?? null,
        });
    }

    for (const rawTag of lead.activity?.recentHashtags ?? []) {
        const tag = rawTag.replace(/^#/, '');
        if (tag.length < 4 || GENERIC_HASHTAGS.has(tag)) continue;
        state.hashtagCounts[tag] = (state.hashtagCounts[tag] ?? 0) + 1;
        const shouldExpand = state.hashtagCounts[tag] === HASHTAG_EXPAND_THRESHOLD
            && !state.expandedHashtags[tag]
            && !input.hashtags.includes(tag)
            && Object.keys(state.expandedHashtags).length < MAX_HASHTAG_EXPANSIONS
            && state.enqueuedProfiles < input.discoveryCap;
        if (shouldExpand) {
            state.expandedHashtags[tag] = true;
            log.info(`Discovery expansion: several discovered brands use #${tag} — exploring it`);
            await crawler.addRequests([hashtagRequest(tag)]);
        }
    }
}

function markShopifyFound(lead) {
    if (!lead.shopifyCounted) {
        lead.shopifyCounted = true;
        counters.shopifyStoresFound += 1;
    }
}

// ---------------------------------------------------------------- handlers

async function handleSearch({ request, $, body, crawler, session, log: rlog }) {
    const { source, engine, query, page = 1 } = request.userData;
    const usernames = extractUsernamesFromSearchPage($, String(body));

    if (!usernames.length) {
        // Past page 1, an empty page usually just means end of results.
        if (page > 1) {
            rlog.debug(`Search "${query}" (${engine}): no more results on page ${page}`);
            return;
        }
        // On page 1, engines serve challenge/consent/empty pages to flagged
        // IPs. Log the diagnostics, then retry through a fresh session/IP —
        // a different exit node often gets real results.
        const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 80);
        rlog.warning(`Search "${query}" (${engine}, page ${page}): no Instagram profiles in response `
            + `(page title: "${title}", body: ${String(body).length} bytes) — retrying with a new session`);
        session?.retire();
        throw new Error(`Search results page from ${engine} contained no Instagram links (possible rate limit)`);
    }

    let added = 0;
    for (const username of usernames) {
        if (await enqueueProfile(crawler, username, source)) added += 1;
    }
    rlog.info(`Search "${query}" (${engine}, page ${page}): `
        + `${usernames.length} profiles found, ${added} new enqueued`);

    // Keep paging this query while the lead quota and discovery cap allow.
    const needMore = state.pushedCount < input.maxResults
        && state.enqueuedProfiles < input.discoveryCap;
    if (needMore) {
        const next = nextSearchPageRequest(request.userData);
        if (next) await crawler.addRequests([next]);
    }
}

// ------------------------------------------ Shopify-first (reverse) flow

/** Register a store-candidate domain and enqueue its homepage check. */
async function enqueueStoreCheck(crawler, { domain, url }, source) {
    if (!domain || state.storeDomains[domain]) return false;
    if (input.excludedDomains.has(domain)) return false;
    if (state.enqueuedStores >= input.discoveryCap) return false;
    if (state.pushedCount >= input.maxResults) return false;
    state.storeDomains[domain] = true;
    state.enqueuedStores += 1;
    await crawler.addRequests([{
        url,
        label: LABELS.STORE_CHECK,
        uniqueKey: `store:${domain}`,
        userData: { label: LABELS.STORE_CHECK, domain, source },
    }]);
    return true;
}

async function handleStoreSearch({ request, $, body, crawler, session, log: rlog }) {
    const { source, engine, query, page = 1 } = request.userData;
    const candidates = extractStoreCandidates($, String(body), engine);

    if (!candidates.length) {
        if (page > 1) {
            rlog.debug(`Store search "${query}" (${engine}): no more results on page ${page}`);
            return;
        }
        const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 80);
        rlog.warning(`Store search "${query}" (${engine}, page ${page}): no store links in response `
            + `(page title: "${title}", body: ${String(body).length} bytes) — retrying with a new session`);
        session?.retire();
        throw new Error(`Store search results from ${engine} contained no candidates (possible rate limit)`);
    }

    let added = 0;
    for (const candidate of candidates) {
        if (await enqueueStoreCheck(crawler, candidate, source)) added += 1;
    }
    rlog.info(`Store search "${query}" (${engine}, page ${page}): `
        + `${candidates.length} candidate domains, ${added} new enqueued`);

    const needMore = state.pushedCount < input.maxResults
        && state.enqueuedStores < input.discoveryCap;
    if (needMore) {
        const next = nextStoreSearchPageRequest(request.userData);
        if (next) await crawler.addRequests([next]);
    }
}

async function handleStoreCheck({ request, response, $, body, crawler, log: rlog }) {
    const { source } = request.userData;
    const finalUrl = request.loadedUrl ?? request.url;
    const html = String(body);
    counters.websitesInspected += 1;
    counters.storeCandidatesChecked += 1;

    const finalDomain = normalizeDomain(finalUrl);
    if (finalDomain && finalDomain !== request.userData.domain) {
        if (state.storeDomains[finalDomain]) return; // redirected to a domain we already handled
        state.storeDomains[finalDomain] = true;
    }

    const platform = detectPlatform(html, response.headers, finalUrl);
    // Every online business becomes a lead; only non-commerce pages
    // (blogs, listicles, junk) are dropped.
    if (!platform.isShopify && !platform.hasOnlineStore) {
        counters.storeCandidatesRejected += 1;
        rlog.debug(`${finalDomain}: store candidate rejected (${platform.platform}, no store signals)`);
        return;
    }
    // Relevance gate: a SERP-discovered store must mention the searched
    // niche somewhere on its page (keeps pizza chains out of skincare lists).
    if (!matchesNiche(html, source?.searchTerm)) {
        counters.storeCandidatesOffTopic += 1;
        rlog.debug(`${finalDomain}: store candidate rejected (page never mentions "${source?.searchTerm}")`);
        return;
    }

    // Locate the store's Instagram account from its social links.
    let igUsername = null;
    $('a[href*="instagram.com"]').each((_, el) => {
        if (igUsername) return;
        igUsername = usernameFromInstagramUrl(unwrapRedirectUrl($(el).attr('href') ?? '') ?? '');
    });
    if (igUsername && input.excludedUsernames.has(igUsername)) return;

    const intelligence = detectStoreIntelligence(html);
    const contact = input.includeContactDetails
        ? extractContacts($, html, finalUrl)
        : { emails: [], phones: [] };
    const candidate = {
        url: request.url,
        finalUrl: stripTrackingParams(finalUrl) ?? finalUrl,
        domain: finalDomain,
        reachable: true,
        https: finalUrl.startsWith('https:'),
        platform: platform.platform,
        isShopify: platform.isShopify,
        shopifyConfidence: platform.shopifyConfidence,
        shopifySignals: platform.shopifySignals,
        hasOnlineStore: platform.hasOnlineStore,
        productCount: null,
        detectedApps: intelligence.detectedApps,
        storeCurrency: intelligence.storeCurrency,
        contact,
    };

    let lead;
    let leadKey;
    if (igUsername) {
        leadKey = igUsername;
        lead = state.leads[igUsername];
        if (!lead) {
            // Creates the lead and enqueues the Instagram enrichment request.
            if (!await enqueueProfile(crawler, igUsername, source)) return;
            lead = state.leads[igUsername];
        }
    } else {
        // No Instagram link on the store: still a valid business lead,
        // keyed by domain, with empty Instagram columns.
        counters.storesWithoutInstagram += 1;
        if (input.requireInstagram) {
            rlog.debug(`${finalDomain}: skipped (user wants Instagram leads only)`);
            return;
        }
        leadKey = `site:${finalDomain}`;
        if (state.leads[leadKey]) return;
        if (state.pushedCount >= input.maxResults) return;
        lead = createLead(null, source);
        lead.status = 'done';
        state.leads[leadKey] = lead;
    }

    if (!lead.websiteCandidates.some((c) => c.domain === candidate.domain)) {
        lead.websiteCandidates.push(candidate);
    }
    if (platform.isShopify) markShopifyFound(lead);
    rlog.info(`${finalDomain}: ${platform.isShopify ? 'confirmed Shopify store' : `online store (${platform.platform})`}`
        + ` → ${igUsername ? `@${igUsername}` : 'no Instagram link'}`);

    // Product-count probe (Shopify only) + contact page, same as forward.
    if (platform.isShopify || platform.inconclusiveShopify) {
        trackLeadRequest(lead);
        await crawler.addRequests([{
            url: new URL('/products.json?limit=250', finalUrl).href,
            label: LABELS.PRODUCTS_JSON,
            uniqueKey: `products:${leadKey}:${canonicalUrl(finalUrl)}`,
            userData: { label: LABELS.PRODUCTS_JSON, username: leadKey, candidateUrl: candidate.finalUrl },
        }]);
    }
    // Shopify convention: /pages/contact usually exists even when the
    // homepage shows no contact link.
    let contactPageUrl = contact.contactPageUrl;
    if (!contactPageUrl && platform.isShopify) {
        contactPageUrl = new URL('/pages/contact', finalUrl).href;
    }
    if (input.includeContactDetails && !contact.emails?.length && contactPageUrl) {
        trackLeadRequest(lead);
        await crawler.addRequests([{
            url: contactPageUrl,
            label: LABELS.CONTACT_PAGE,
            uniqueKey: `contact:${leadKey}:${canonicalUrl(contactPageUrl)}`,
            userData: { label: LABELS.CONTACT_PAGE, username: leadKey, candidateUrl: candidate.finalUrl },
        }]);
    }
    // Store-only leads have no profile phase; finalize once probes settle.
    if (!igUsername) await finalizeLead(lead);
}

async function handleGoogleSearch({ request, json, crawler, log: rlog }) {
    const { kind, query, source, start = 1 } = request.userData;
    const links = extractLinksFromCse(json);
    if (!links.length) {
        rlog.info(`Google CSE "${query}" (start ${start}): no results${json?.error ? ` (${json.error.message})` : ''}`);
        return;
    }

    let added = 0;
    if (kind === 'profiles') {
        for (const link of links) {
            const username = usernameFromInstagramUrl(link);
            if (username && await enqueueProfile(crawler, username, source)) added += 1;
        }
    } else {
        for (const candidate of storeCandidatesFromUrls(links)) {
            if (await enqueueStoreCheck(crawler, candidate, source)) added += 1;
        }
    }
    rlog.info(`Google CSE "${query}" (${kind}, start ${start}): ${links.length} results, ${added} new enqueued`);

    const needMore = state.pushedCount < input.maxResults;
    if (needMore) {
        const next = nextGooglePageRequest(input, request.userData);
        if (next) await crawler.addRequests([next]);
    }
}

async function handleTopsearch({ request, json, crawler, session, log: rlog }) {
    const { query, source } = request.userData;
    await sleep(200 + Math.random() * 600);

    if (isTopsearchBlocked(json)) {
        session?.retire();
        throw new Error(`Instagram keyword search blocked for "${query}" (login wall)`);
    }

    const usernames = extractUsernamesFromTopsearch(json);
    let added = 0;
    for (const username of usernames) {
        if (await enqueueProfile(crawler, username, source)) added += 1;
    }
    rlog.info(`Instagram search "${query}": ${usernames.length} accounts found, ${added} new enqueued`);
}

async function handleHashtag({ request, json, crawler, log: rlog }) {
    const { hashtag } = request.userData;
    await sleep(200 + Math.random() * 600);

    const blocked = !json || isHashtagResponseBlocked(json);
    const usernames = blocked ? [] : extractUsernamesFromHashtagResponse(json);

    if (!usernames.length) {
        rlog.warning(`Hashtag #${hashtag}: ${blocked ? 'login wall' : 'no profiles'} — `
            + 'falling back to search-engine discovery');
        await crawler.addRequests(buildHashtagFallbackRequests(hashtag));
        return;
    }

    const source = { discoveryMethod: 'hashtag', searchTerm: `#${hashtag}`, locationQuery: null };
    let added = 0;
    for (const username of usernames) {
        if (await enqueueProfile(crawler, username, source)) added += 1;
    }
    rlog.info(`Hashtag #${hashtag}: ${usernames.length} profiles found, ${added} new enqueued`);
}

async function handleProfile({ request, response, json, crawler, session, log: rlog }) {
    const { username } = request.userData;
    const lead = state.leads[username];
    if (!lead) return;
    await sleep(200 + Math.random() * 600);

    if (response.statusCode === 404 || (json?.data && json.data.user === null)) {
        lead.status = 'failed';
        lead.error = 'Profile not found (deleted or renamed)';
        counters.profilesSkipped += 1;
        await finalizeLead(lead);
        return;
    }

    const user = json?.data?.user;
    if (!user) {
        // Login wall / challenge: retire the session and retry with another.
        session?.retire();
        throw new Error(`Profile API blocked for @${username} (login wall or challenge)`);
    }

    state.apiOks += 1;
    lead.profile = parseProfileApi(user);
    lead.activity = analyzeActivity(user, input.recentPostsToAnalyze);
    counters.profilesProcessed += 1;

    if (input.expandDiscovery) await expandDiscoveryFrom(crawler, lead, user);

    await continueAfterProfile(crawler, lead);
    rlog.debug(`@${username}: profile extracted (${lead.status})`);
}

async function handleProfileHtml({ request, $, crawler, log: rlog }) {
    const { username } = request.userData;
    const lead = state.leads[username];
    if (!lead) return;
    await sleep(200 + Math.random() * 600);

    const profile = parseProfileHtml($, username);
    if (!profile) {
        lead.status = 'failed';
        lead.error = 'Profile requires login (Instagram login wall)';
        counters.profilesSkipped += 1;
        await finalizeLead(lead);
        return;
    }

    lead.profile = profile;
    lead.error = 'Limited profile data (Instagram API blocked; HTML page used)';
    counters.profilesProcessed += 1;
    rlog.info(`@${username}: profile extracted from HTML page`
        + (profile.externalUrl ? ` (bio URL: ${profile.externalUrl})` : ''));

    // Bio text often spells out the website — continue the pipeline with it.
    await continueAfterProfile(crawler, lead);
}

/** Core website inspection; the wrapper below handles request accounting. */
async function inspectWebsite({ request, response, $, body, crawler, log: rlog }, lead) {
    const { username, depth = 0 } = request.userData;
    const finalUrl = request.loadedUrl ?? request.url;
    const html = String(body);
    counters.websitesInspected += 1;

    // Link-in-bio page: extract outbound business links instead of detecting.
    const service = linkInBioService(finalUrl) ?? linkInBioService(request.url);
    if (service && depth < 2) {
        lead.bioLinkService = service;
        const links = extractOutboundLinks($, finalUrl, input.maxBioLinksToInspect);
        rlog.info(`@${username}: ${service} page — ${links.length} business link(s) selected`);
        if (links.length) {
            trackLeadRequest(lead, links.length);
            await crawler.addRequests(links.map((link) => ({
                url: link.url,
                label: LABELS.WEBSITE,
                uniqueKey: `web:${username}:${canonicalUrl(link.url)}`,
                userData: { label: LABELS.WEBSITE, username, depth: depth + 1 },
            })));
            lead.status = 'website_pending';
            return;
        }
        // No outbound links — fall through and analyze the page itself.
    }

    const domain = normalizeDomain(finalUrl);
    if (domain && input.excludedDomains.has(domain)) {
        lead.status = 'filtered';
        lead.filterReason = 'excluded';
        return;
    }

    const platform = detectPlatform(html, response.headers, finalUrl);
    const intelligence = detectStoreIntelligence(html);
    const contact = input.includeContactDetails
        ? extractContacts($, html, finalUrl)
        : { emails: [], phones: [] };

    const candidate = {
        url: request.url,
        finalUrl: stripTrackingParams(finalUrl) ?? finalUrl,
        domain,
        reachable: true,
        https: finalUrl.startsWith('https:'),
        platform: platform.platform,
        isShopify: platform.isShopify,
        shopifyConfidence: platform.shopifyConfidence,
        shopifySignals: platform.shopifySignals,
        hasOnlineStore: platform.hasOnlineStore,
        productCount: null,
        detectedApps: intelligence.detectedApps,
        storeCurrency: intelligence.storeCurrency,
        contact,
    };
    lead.websiteCandidates.push(candidate);
    lead.status = 'done';

    if (platform.isShopify) markShopifyFound(lead);

    // Confirmation / product-count probe via the public products.json endpoint.
    if (platform.isShopify || platform.inconclusiveShopify) {
        const probeUrl = new URL('/products.json?limit=250', finalUrl).href;
        trackLeadRequest(lead);
        await crawler.addRequests([{
            url: probeUrl,
            label: LABELS.PRODUCTS_JSON,
            uniqueKey: `products:${username}:${canonicalUrl(probeUrl)}`,
            userData: { label: LABELS.PRODUCTS_JSON, username, candidateUrl: candidate.finalUrl },
        }]);
    }

    // Cost control: skip contact-page enrichment for confirmed non-Shopify
    // sites when the user only wants Shopify leads (row would be filtered).
    const skipDeepEnrichment = input.requireShopify && !platform.isShopify
        && !platform.inconclusiveShopify && platform.platform !== 'Unknown';

    // Shopify convention: /pages/contact usually exists even when the
    // homepage shows no contact link.
    let contactPageUrl = contact.contactPageUrl;
    if (!contactPageUrl && platform.isShopify) {
        contactPageUrl = new URL('/pages/contact', finalUrl).href;
    }
    if (input.includeContactDetails && !skipDeepEnrichment
        && !contact.emails?.length && contactPageUrl) {
        trackLeadRequest(lead);
        await crawler.addRequests([{
            url: contactPageUrl,
            label: LABELS.CONTACT_PAGE,
            uniqueKey: `contact:${username}:${canonicalUrl(contactPageUrl)}`,
            userData: { label: LABELS.CONTACT_PAGE, username, candidateUrl: candidate.finalUrl },
        }]);
    }
}

async function handleWebsite(context) {
    const lead = state.leads[context.request.userData.username];
    if (!lead) return;
    try {
        await inspectWebsite(context, lead);
    } catch (error) {
        context.log.warning(`Website inspection failed for @${lead.username}: ${error.message}`);
    }
    await completeLeadRequest(lead);
}

function findCandidate(lead, candidateUrl) {
    return lead?.websiteCandidates.find((c) => c.finalUrl === candidateUrl || c.url === candidateUrl);
}

async function handleProductsJson({ request, json, log: rlog }) {
    const { username, candidateUrl } = request.userData;
    const lead = state.leads[username];
    try {
        const candidate = findCandidate(lead, candidateUrl);
        if (candidate) {
            const { confirmed, productCount } = parseProductsJson(json);
            if (productCount != null) candidate.productCount = productCount;
            if (confirmed) {
                if (!candidate.isShopify) {
                    candidate.isShopify = true;
                    candidate.platform = 'Shopify';
                    candidate.shopifyConfidence = Math.min(1, (candidate.shopifyConfidence ?? 0) + 0.5);
                    markShopifyFound(lead);
                    rlog.info(`@${username}: Shopify confirmed via products.json (${productCount} products)`);
                }
                candidate.shopifySignals = [
                    ...(candidate.shopifySignals ?? []),
                    'Shopify /products.json endpoint returned a valid product payload',
                ];
            }
        }
    } catch (error) {
        rlog.debug(`products.json probe failed for @${username}: ${error.message}`);
    }
    await completeLeadRequest(lead);
}

async function handleContactPage({ request, $, body, crawler, log: rlog }) {
    const { username, candidateUrl, secondPass } = request.userData;
    const lead = state.leads[username];
    try {
        const candidate = findCandidate(lead, candidateUrl);
        if (candidate) {
            const found = extractContacts($, String(body), request.loadedUrl ?? request.url, { deepText: true });
            candidate.contact = {
                ...candidate.contact,
                emails: [...new Set([...(candidate.contact?.emails ?? []), ...found.emails])],
                phones: [...new Set([...(candidate.contact?.phones ?? []), ...found.phones])],
                contactPageUrl: candidate.contact?.contactPageUrl ?? (request.loadedUrl ?? request.url),
                aboutPageUrl: candidate.contact?.aboutPageUrl ?? found.aboutPageUrl ?? null,
            };
            if (found.emails.length) rlog.debug(`${username}: email found on contact page`);

            // Second pass: still no email and an about page exists — many
            // small brands publish their email there instead.
            const aboutUrl = candidate.contact.aboutPageUrl;
            if (!secondPass && !candidate.contact.emails.length && aboutUrl
                && canonicalUrl(aboutUrl) !== canonicalUrl(request.loadedUrl ?? request.url)) {
                trackLeadRequest(lead);
                await crawler.addRequests([{
                    url: aboutUrl,
                    label: LABELS.CONTACT_PAGE,
                    uniqueKey: `about:${username}:${canonicalUrl(aboutUrl)}`,
                    userData: { label: LABELS.CONTACT_PAGE, username, candidateUrl, secondPass: true },
                }]);
            }
        }
    } catch (error) {
        rlog.debug(`Contact page extraction failed for ${username}: ${error.message}`);
    }
    await completeLeadRequest(lead);
}

// ---------------------------------------------------------------- crawler

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxConcurrency,
    minConcurrency: 1,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 90,
    sameDomainDelaySecs: 1,
    additionalMimeTypes: ['application/json'],
    ignoreHttpErrorStatusCodes: [404],
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 30,
        sessionOptions: { maxUsageCount: 30 },
    },
    autoscaledPoolOptions: { desiredConcurrency: Math.min(2, input.maxConcurrency) },
    maxRequestsPerCrawl: 100 + input.discoveryCap * 6,

    // Crawlee's default periodic status ("Experiencing problems, N failed
    // requests…") is meant for operators, not users. Keep that detail in
    // the log and show a clean progress line on the run card instead.
    statusMessageLoggingInterval: 15,
    async statusMessageCallback(ctx) {
        if (ctx.message) log.info(`Crawler status: ${ctx.message}`);
        return ctx.crawler.setStatusMessage(
            `Saved ${state.pushedCount}/${input.maxResults} leads · ${counters.profilesDiscovered} profiles discovered `
            + `· ${counters.profilesProcessed} analyzed · ${counters.shopifyStoresFound} Shopify stores found`,
        );
    },

    preNavigationHooks: [
        async ({ request }, gotOptions) => {
            gotOptions.maxRedirects = 6;
            gotOptions.timeout = { request: 45_000 };

            const { label } = request.userData;
            if (label === LABELS.PROFILE || label === LABELS.HASHTAG
                || label === LABELS.PROFILE_HTML || label === LABELS.TOPSEARCH) {
                request.headers = {
                    ...request.headers,
                    'x-ig-app-id': IG_APP_ID,
                    accept: '*/*',
                    referer: 'https://www.instagram.com/',
                    ...(input.instagramSessionCookies ? { cookie: input.instagramSessionCookies } : {}),
                };
            }
        },
    ],

    // Called before each retry: when the profile API is blocked — either a
    // hard 401/403/429 or a 200 login-wall response our handler rejects —
    // one retry is enough. Fail fast so the HTML fallback kicks in instead
    // of burning attempts and minutes (each retry costs ~1s of domain delay).
    async errorHandler({ request }, error) {
        const blocked = /40[13]|429|login wall|challenge|blocked/i.test(error?.message ?? '');
        if (request.userData.label === LABELS.PROFILE && blocked) {
            state.apiBlocks += 1;
            if (request.retryCount >= 1) request.noRetry = true;
        }
    },

    async requestHandler(context) {
        switch (context.request.userData.label) {
            case LABELS.SEARCH: return handleSearch(context);
            case LABELS.GOOGLE_SEARCH: return handleGoogleSearch(context);
            case LABELS.STORE_SEARCH: return handleStoreSearch(context);
            case LABELS.STORE_CHECK: return handleStoreCheck(context);
            case LABELS.TOPSEARCH: return handleTopsearch(context);
            case LABELS.HASHTAG: return handleHashtag(context);
            case LABELS.PROFILE: return handleProfile(context);
            case LABELS.PROFILE_HTML: return handleProfileHtml(context);
            case LABELS.WEBSITE: return handleWebsite(context);
            case LABELS.PRODUCTS_JSON: return handleProductsJson(context);
            case LABELS.CONTACT_PAGE: return handleContactPage(context);
            default:
                context.log.warning(`Unknown label for ${context.request.url}`);
                return undefined;
        }
    },

    async failedRequestHandler({ request, crawler: c }, error) {
        const { label, username } = request.userData;
        const lead = username ? state.leads[username] : null;

        if (label === LABELS.PROFILE && lead && !lead.profile) {
            // API blocked — recover via the plain HTML page instead of
            // counting this as a failure (the lead is still in play).
            log.info(`@${username}: profile API blocked (${error.message.split('\n')[0]}) — using HTML fallback`);
            await c.addRequests([{
                url: IG_PROFILE_URL(username),
                label: LABELS.PROFILE_HTML,
                uniqueKey: `profilehtml:${username}`,
                userData: { label: LABELS.PROFILE_HTML, username },
            }]);
            return;
        }
        if (label === LABELS.GOOGLE_SEARCH) {
            log.warning(`Google Custom Search request failed (${error.message.split('\n')[0]}) `
                + '— check the API key and daily quota. Free engines continue.');
            return;
        }
        if (label === LABELS.TOPSEARCH) {
            // Expected degradation on login-walled IP pools — search
            // engines remain the discovery backbone.
            log.info(`Instagram keyword search unavailable (${error.message.split('\n')[0]}) — relying on search engines`);
            return;
        }
        counters.failedRequests += 1;
        if (label === LABELS.PROFILE_HTML && lead) {
            lead.status = 'failed';
            lead.error = 'Instagram profile unavailable (login wall or rate limiting)';
            counters.profilesSkipped += 1;
            await finalizeLead(lead);
            return;
        }
        if (label === LABELS.WEBSITE && lead) {
            lead.websiteCandidates.push({
                url: request.url,
                finalUrl: request.loadedUrl ?? request.url,
                domain: normalizeDomain(request.url),
                reachable: false,
                platform: 'Unreachable',
                isShopify: false,
                shopifyConfidence: 0,
                shopifySignals: [],
                hasOnlineStore: false,
                contact: { emails: [], phones: [] },
            });
            lead.websiteFailed = true;
            if (lead.status === 'website_pending') lead.status = 'done';
            await completeLeadRequest(lead);
            return;
        }
        if ((label === LABELS.PRODUCTS_JSON || label === LABELS.CONTACT_PAGE) && lead) {
            await completeLeadRequest(lead);
            return;
        }
        // SEARCH / HASHTAG failures are non-fatal.
        log.debug(`Request failed (${label}): ${request.url} — ${error.message}`);
    },
});

// ------------------------------------------------------------ run + output

const initialRequests = buildInitialRequests(input);

// Register direct-input profiles in the lead store before the run.
for (const req of initialRequests) {
    if (req.userData.label === LABELS.PROFILE && !state.leads[req.userData.username]) {
        state.leads[req.userData.username] = createLead(req.userData.username, req.userData.source);
        state.enqueuedProfiles += 1;
        counters.profilesDiscovered += 1;
    }
}

if (!initialRequests.length) throw new Error('No valid discovery requests could be built from the input.');
log.info(`Starting crawl with ${initialRequests.length} initial request(s) `
    + `(discovery cap: ${input.discoveryCap} profiles)`);

await crawler.run(initialRequests);

// Safety net: finalize any lead still open (e.g. its requests were dropped
// by the crawl-size cap). Normally everything is already pushed by now.
log.info('Crawl finished — finalizing remaining leads…');
for (const lead of Object.values(state.leads)) {
    await finalizeLead(lead, { force: true });
}

const summary = {
    profilesDiscovered: counters.profilesDiscovered,
    profilesProcessed: counters.profilesProcessed,
    profilesSkipped: counters.profilesSkipped,
    websitesInspected: counters.websitesInspected,
    shopifyStoresFound: counters.shopifyStoresFound,
    leadsSaved: state.pushedCount,
    leadsWithEmail: counters.leadsWithEmail,
    highQualityLeads: counters.highQualityLeads,
    duplicatesRemoved: counters.duplicatesRemoved,
    failedRequests: counters.failedRequests,
    storeCandidatesChecked: counters.storeCandidatesChecked,
    storeCandidatesRejected: counters.storeCandidatesRejected,
    storeCandidatesOffTopic: counters.storeCandidatesOffTopic,
    storesWithoutInstagram: counters.storesWithoutInstagram,
    incompleteLeadsSkipped: counters.incompleteLeadsSkipped,
    discoveryMode: input.discoveryMode,
    filteredOut: counters.filteredOut,
};
await Actor.setValue(RUN_SUMMARY_KEY, summary);
await persistHistory();

log.info('──────────────── RUN SUMMARY ────────────────');
log.info(`Profiles discovered:   ${summary.profilesDiscovered}`);
log.info(`Profiles processed:    ${summary.profilesProcessed}`);
log.info(`Profiles skipped:      ${summary.profilesSkipped}`);
log.info(`Websites inspected:    ${summary.websitesInspected}`);
if (summary.storeCandidatesChecked > 0) {
    log.info(`Store candidates:      ${summary.storeCandidatesChecked} checked, `
        + `${summary.storeCandidatesRejected} not online stores, `
        + `${summary.storeCandidatesOffTopic} off-topic for the niche, `
        + `${summary.storesWithoutInstagram} kept as store-only leads (no Instagram link)`);
}
if (summary.incompleteLeadsSkipped > 0) {
    log.info(`Incomplete leads:      ${summary.incompleteLeadsSkipped} skipped `
        + '(no website, contacts, or full profile data; includeIncompleteLeads: true keeps them)');
}
log.info(`Shopify stores found:  ${summary.shopifyStoresFound}`);
log.info(`Leads saved:           ${summary.leadsSaved}`);
log.info(`Leads with email:      ${summary.leadsWithEmail}`);
log.info(`High-quality leads:    ${summary.highQualityLeads}`);
log.info(`Duplicates removed:    ${summary.duplicatesRemoved}`);
log.info(`Failed requests:       ${summary.failedRequests}`);
log.info(`Filtered out:          ${JSON.stringify(summary.filteredOut)}`);
log.info('─────────────────────────────────────────────');

const quotaNote = summary.leadsSaved < input.maxResults
    ? ` (requested ${input.maxResults}; the log's filtered-out breakdown explains why fewer matched)`
    : '';
await Actor.setStatusMessage(
    `Done: ${summary.leadsSaved} leads saved${quotaNote} · ${summary.leadsWithEmail} with email `
    + `· ${summary.shopifyStoresFound} Shopify stores`,
    { isStatusMessageTerminal: true },
);

await Actor.exit();
