/**
 * Search-engine discovery: finds public Instagram profile URLs via
 * "site:instagram.com <niche> <location>" queries on DuckDuckGo HTML
 * and Bing. Both work without authentication.
 *
 * The parser is intentionally selector-light: it collects every
 * instagram.com link on the results page (including redirect-wrapped ones)
 * and lets username extraction filter out post/reel/explore/login URLs.
 */
import { LABELS, SEARCH_ENGINE_BUILDERS, MAX_SEARCH_PAGES } from '../constants.js';
import { usernameFromInstagramUrl, unwrapRedirectUrl } from '../utils/normalize.js';

/**
 * Coverage note: search engines index a profile page's title (name/handle)
 * AND its bio text, but literal name matches dominate the ranking. To reach
 * brands whose *name* does not contain the keyword, each term is expanded
 * with commerce modifiers ("shop", "brand") that typically appear in the
 * bios of business accounts. Deeper coverage comes from the crawler's
 * auto-expansion (related profiles + co-occurring hashtags) in main.js.
 */
export function buildQueryVariants(term) {
    const clean = term.trim();
    const lower = clean.toLowerCase();
    const variants = [clean];
    if (!/\b(shop|store)\b/.test(lower)) variants.push(`${clean} shop`);
    if (!/\bbrands?\b/.test(lower)) variants.push(`${clean} brand`);
    return variants;
}

/** Build "site:instagram.com …" queries from terms × locations × variants. */
export function buildSearchQueries(searchTerms, locations) {
    const queries = [];
    const locs = locations?.length ? locations : [''];
    for (const term of searchTerms ?? []) {
        for (const variant of buildQueryVariants(term)) {
            for (const loc of locs) {
                queries.push(`site:instagram.com ${variant}${loc ? ` ${loc}` : ''}`.trim());
            }
        }
    }
    return queries;
}

function searchRequest(engine, query, source, page = 1) {
    const builder = SEARCH_ENGINE_BUILDERS[engine] ?? SEARCH_ENGINE_BUILDERS.duckduckgo;
    return {
        url: builder(query, page),
        label: LABELS.SEARCH,
        uniqueKey: `${engine}:${query}:p${page}`,
        userData: { label: LABELS.SEARCH, engine, query, source, page },
    };
}

function searchRequestsForQuery(query, source) {
    return Object.keys(SEARCH_ENGINE_BUILDERS).map((engine) => searchRequest(engine, query, source));
}

/**
 * Next results page for the same engine + query, or null when the page
 * limit is reached. Used to keep discovering until the lead quota is met.
 */
export function nextSearchPageRequest({ engine, query, source, page = 1 }) {
    if (page >= MAX_SEARCH_PAGES) return null;
    return searchRequest(engine, query, source, page + 1);
}

export function buildSearchRequests(searchTerms, locations) {
    const requests = [];
    const locs = locations?.length ? locations : [''];
    for (const term of searchTerms ?? []) {
        for (const variant of buildQueryVariants(term)) {
            for (const loc of locs) {
                const query = `site:instagram.com ${variant}${loc ? ` ${loc}` : ''}`.trim();
                const source = {
                    discoveryMethod: 'search',
                    searchTerm: term,
                    locationQuery: loc || null,
                };
                requests.push(...searchRequestsForQuery(query, source));
            }
        }
    }
    return requests;
}

/** Fallback used when Instagram's hashtag API is login-walled. */
export function buildHashtagFallbackRequests(tag) {
    const query = `site:instagram.com "#${tag}"`;
    const source = { discoveryMethod: 'hashtag-search', searchTerm: `#${tag}`, locationQuery: null };
    return searchRequestsForQuery(query, source);
}

/**
 * Extract unique Instagram usernames from a search-results page.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} html raw response body (used for regex sweep)
 * @returns {string[]} usernames
 */
export function extractUsernamesFromSearchPage($, html) {
    const candidates = new Set();

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        // Direct links, DuckDuckGo uddg= redirects, and Bing /ck/a
        // base64-wrapped redirects (target URL not literally present).
        if (!href.includes('instagram.com') && !href.includes('uddg=') && !href.includes('/ck/')) return;
        const unwrapped = unwrapRedirectUrl(href.startsWith('//') ? `https:${href}` : href);
        if (unwrapped) candidates.add(unwrapped);
    });

    // Regex sweep catches <cite> elements and unlinked mentions.
    for (const match of html?.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._%/-]+/g) ?? []) {
        candidates.add(decodeURIComponent(match));
    }

    const usernames = new Set();
    for (const candidate of candidates) {
        const username = usernameFromInstagramUrl(candidate);
        if (username) usernames.add(username);
    }
    return [...usernames];
}
