/**
 * Shopify-first (reverse) discovery: instead of finding Instagram profiles
 * and checking whether their website is Shopify, find Shopify storefronts
 * on the open web first ("powered by shopify" / site:myshopify.com niche
 * queries) and then locate each store's Instagram account from its social
 * links. Shopify density is ~100% by construction and the heavily
 * rate-limited Instagram step becomes enrichment instead of discovery.
 *
 * The classic Instagram-first pipeline remains available side by side —
 * `discoveryMode` selects which one (or both) runs.
 */
import {
    LABELS, SEARCH_ENGINE_BUILDERS, MAX_SEARCH_PAGES, NON_STORE_DOMAINS, LINK_IN_BIO_HOSTS,
} from '../constants.js';
import { toUrl, unwrapRedirectUrl, normalizeDomain } from '../utils/normalize.js';
import { buildQueryVariants } from './search-engine.js';

/**
 * Search queries that surface Shopify storefronts in a niche. Each term
 * variant (term, "term shop", "term brand") is crossed with both Shopify
 * footprints, so a single niche keyword yields up to six distinct queries
 * per engine; this is what keeps strict runs able to fill their quota.
 */
export function buildStoreQueries(term, location) {
    const loc = location ? ` ${location}` : '';
    const queries = [];
    for (const variant of buildQueryVariants(term)) {
        queries.push(`"powered by shopify" ${variant}${loc}`);
        queries.push(`site:myshopify.com ${variant}${loc}`);
    }
    return queries;
}

function storeSearchRequest(engine, query, source, page = 1) {
    const builder = SEARCH_ENGINE_BUILDERS[engine] ?? SEARCH_ENGINE_BUILDERS.duckduckgo;
    return {
        url: builder(query, page),
        label: LABELS.STORE_SEARCH,
        uniqueKey: `store-${engine}:${query}:p${page}`,
        userData: { label: LABELS.STORE_SEARCH, engine, query, source, page },
    };
}

export function buildStoreSearchRequests(searchTerms, locations) {
    const requests = [];
    const locs = locations?.length ? locations : [''];
    for (const term of searchTerms ?? []) {
        for (const loc of locs) {
            const source = { discoveryMethod: 'shopify-first', searchTerm: term, locationQuery: loc || null };
            for (const query of buildStoreQueries(term, loc)) {
                for (const engine of Object.keys(SEARCH_ENGINE_BUILDERS)) {
                    requests.push(storeSearchRequest(engine, query, source));
                }
            }
        }
    }
    return requests;
}

export function nextStoreSearchPageRequest({ engine, query, source, page = 1 }) {
    if (page >= MAX_SEARCH_PAGES) return null;
    return storeSearchRequest(engine, query, source, page + 1);
}

// Words too generic to prove a store belongs to the user's niche.
const NICHE_STOPWORDS = new Set([
    'brand', 'brands', 'shop', 'shops', 'store', 'stores', 'online', 'best',
    'top', 'the', 'and', 'for', 'with', 'buy', 'cheap', 'new', 'official',
]);

/**
 * Does this store page look like it belongs to the searched niche?
 * SERP-discovered candidates can be anything (the engines serve junk to
 * automated traffic), so a store-first candidate must mention at least one
 * meaningful token of the search term somewhere in its HTML before it is
 * accepted. Without a search term there is nothing to check against.
 */
export function matchesNiche(html, searchTerm) {
    if (!searchTerm) return true;
    const tokens = String(searchTerm).toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !NICHE_STOPWORDS.has(token));
    if (!tokens.length) return true;
    const haystack = (html ?? '').toLowerCase();
    return tokens.some((token) => haystack.includes(token));
}

function isExcludedStoreHost(hostname) {
    const clean = hostname.toLowerCase().replace(/^www\./, '');
    for (const domain of NON_STORE_DOMAINS) {
        if (clean === domain || clean.endsWith(`.${domain}`)) return true;
    }
    for (const domain of Object.keys(LINK_IN_BIO_HOSTS)) {
        if (clean === domain || clean.endsWith(`.${domain}`)) return true;
    }
    return false;
}

// Organic-result link selectors per engine. Scoping to these avoids
// harvesting sidebar/footer/ad junk from SERPs; the generic all-anchors
// fallback only runs when the engine's markup changed.
const RESULT_SELECTORS = {
    bing: 'li.b_algo h2 a[href], li.b_algo a.tilk[href]',
    duckduckgo: 'a.result__a[href]',
    'duckduckgo-lite': 'a.result-link[href]',
    mojeek: 'ul.results-standard a[href], .results a[href]',
};

/**
 * Extract candidate store homepages from a search-results page:
 * organic-result links (redirect-unwrapped) that are not known
 * non-store domains, plus any myshopify.com mentions in the raw HTML.
 * Deep result URLs are normalized to the domain's homepage.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} html
 * @param {string} [engine] engine id for scoped result selectors
 * @returns {{ domain: string, url: string }[]}
 */
function addStoreCandidate(byDomain, raw) {
    if (!raw) return;
    let href = raw.trim();
    if (href.startsWith('//')) href = `https:${href}`;
    const url = toUrl(unwrapRedirectUrl(href));
    if (!url || !/^https?:$/.test(url.protocol)) return;
    if (isExcludedStoreHost(url.hostname)) return;
    const domain = normalizeDomain(url.href);
    if (!domain || !domain.includes('.') || byDomain.has(domain)) return;
    byDomain.set(domain, `${url.protocol}//${url.hostname}/`);
}

/** Store candidates from a plain list of URLs (e.g. Google CSE results). */
export function storeCandidatesFromUrls(urls) {
    const byDomain = new Map();
    for (const url of urls ?? []) addStoreCandidate(byDomain, url);
    return [...byDomain.entries()].map(([domain, url]) => ({ domain, url }));
}

export function extractStoreCandidates($, html, engine) {
    const byDomain = new Map();
    const add = (raw) => addStoreCandidate(byDomain, raw);

    const selector = engine ? RESULT_SELECTORS[engine] : null;
    let scopedMatches = 0;
    if (selector) {
        $(selector).each((_, el) => {
            scopedMatches += 1;
            add($(el).attr('href'));
        });
    }
    if (!selector || scopedMatches === 0) {
        $('a[href]').each((_, el) => add($(el).attr('href')));
    }

    for (const match of html?.match(/https?:\/\/[a-z0-9-]+\.myshopify\.com/gi) ?? []) {
        add(match);
    }

    return [...byDomain.entries()].map(([domain, url]) => ({ domain, url }));
}
