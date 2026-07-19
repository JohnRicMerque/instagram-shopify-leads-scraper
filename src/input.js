/**
 * Input parsing and validation. Throws a readable error when no discovery
 * source is provided; clamps every numeric knob to a safe range.
 */
import { normalizeUsername, normalizeDomain } from './utils/normalize.js';

function cleanStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
}

function clamp(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
}

export function parseInput(raw) {
    const input = raw ?? {};

    const searchTerms = cleanStringArray(input.searchTerms);
    const locations = cleanStringArray(input.locations);
    const hashtags = cleanStringArray(input.hashtags)
        .map((tag) => tag.replace(/^#+/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''))
        .filter(Boolean);

    const startUrls = (Array.isArray(input.startUrls) ? input.startUrls : [])
        .map((item) => (typeof item === 'string' ? item : item?.url))
        .filter((url) => typeof url === 'string' && url.trim());

    const usernames = [...new Set(
        [...cleanStringArray(input.usernames), ...startUrls]
            .map((value) => normalizeUsername(value))
            .filter(Boolean),
    )];

    if (!searchTerms.length && !hashtags.length && !usernames.length) {
        throw new Error(
            'No discovery source provided. Fill in at least one of: '
            + '"searchTerms", "hashtags", "usernames", or "startUrls" (Instagram profile URLs).',
        );
    }

    const excludedUsernames = new Set(
        cleanStringArray(input.excludedUsernames).map((u) => normalizeUsername(u)).filter(Boolean),
    );
    const excludedDomains = new Set(
        cleanStringArray(input.excludedDomains).map((d) => normalizeDomain(d)).filter(Boolean),
    );

    const maxResults = clamp(input.maxResults, 1, 5000, 10);

    // Which businesses to keep:
    //  - shopify-instagram (default): verified Shopify store AND a matched
    //    Instagram account — the core promise of this Actor
    //  - instagram: must have Instagram, any (or no) store platform
    //  - shopify: must be a verified Shopify store, Instagram optional
    //  - all: keep every business found
    const validLeadTypes = ['shopify-instagram', 'instagram', 'shopify', 'all'];
    const leadType = validLeadTypes.includes(input.leadType) ? input.leadType : 'shopify-instagram';
    const requireShopify = leadType === 'shopify' || leadType === 'shopify-instagram'
        || input.requireShopify === true;
    const requireInstagram = leadType === 'instagram' || leadType === 'shopify-instagram';

    // Discover more profiles than requested leads because filters
    // (followers, Shopify-only, …) will drop a share of them. Shopify-only
    // runs drop the majority, so they get a much bigger buffer.
    const discoveryMultiplier = requireShopify ? 6 : 2;
    const discoveryCap = Math.min(maxResults * discoveryMultiplier, Math.max(3000, maxResults));

    // How search terms discover leads:
    //  - shopify-first: find Shopify stores on the web, then their Instagram
    //    (sidesteps Instagram rate limits; every lead is a store).
    //  - instagram-first: the classic pipeline (profiles -> bio -> website).
    //  - both: run the two pipelines side by side.
    //  - auto: shopify-first when the user wants Shopify-only leads,
    //    otherwise both.
    const validModes = ['auto', 'shopify-first', 'instagram-first', 'both'];
    const modeChoice = validModes.includes(input.discoveryMode) ? input.discoveryMode : 'auto';
    // Auto: pure store-first only when Instagram is NOT required (store-first
    // alone serves Shopify-only perfectly); otherwise run both pipelines so
    // Instagram-side discovery contributes candidates too.
    const discoveryMode = modeChoice === 'auto'
        ? (requireShopify && !requireInstagram ? 'shopify-first' : 'both')
        : modeChoice;

    return {
        searchTerms,
        locations,
        hashtags,
        usernames,
        maxResults,
        discoveryCap,
        minimumFollowers: clamp(input.minimumFollowers, 0, 1e9, 0),
        maximumFollowers: clamp(input.maximumFollowers, 0, 1e9, 0), // 0 = no cap
        leadType,
        requireShopify,
        requireInstagram,
        discoveryMode,
        expandDiscovery: input.expandDiscovery !== false,
        includeContactDetails: input.includeContactDetails !== false,
        // Recent posts ship inside the same profile API response, so
        // analyzing all 12 costs no extra requests.
        recentPostsToAnalyze: clamp(input.recentPostsToAnalyze, 0, 12, 12),
        onlyActiveProfiles: input.onlyActiveProfiles === true,
        requireEmail: input.requireEmail === true,
        skipPreviousLeads: input.skipPreviousLeads === true,
        resetLeadsHistory: input.resetLeadsHistory === true,
        includeIncompleteLeads: input.includeIncompleteLeads === true,
        googleApiKey: typeof input.googleApiKey === 'string' ? input.googleApiKey.trim() || null : null,
        googleCseId: typeof input.googleCseId === 'string' ? input.googleCseId.trim() || null : null,
        minimumLeadScore: clamp(input.minimumLeadScore, 0, 100, 0),
        strictLocationFilter: input.strictLocationFilter === true,
        excludedUsernames,
        excludedDomains,
        maxBioLinksToInspect: clamp(input.maxBioLinksToInspect, 1, 5, 3),
        instagramSessionCookies: typeof input.instagramSessionCookies === 'string'
            ? input.instagramSessionCookies.trim() || null
            : null,
        maxConcurrency: clamp(input.maxConcurrency, 1, 20, 5),
        // Instagram aggressively 401-blocks datacenter IPs; residential is
        // effectively required for profile extraction at any scale.
        proxyConfiguration: input.proxyConfiguration
            ?? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    };
}
