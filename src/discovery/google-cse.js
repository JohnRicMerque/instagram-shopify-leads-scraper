/**
 * Optional discovery via Google Custom Search JSON API. The user supplies
 * their own API key + Programmable Search Engine ID (100 free queries per
 * day per key), which gives access to Google's index — far deeper and more
 * stable than the free engines. Purely additive: when no key is provided,
 * this module contributes nothing.
 */
import { LABELS } from '../constants.js';
import { buildQueryVariants } from './search-engine.js';
import { buildStoreQueries } from './store-search.js';

export const GOOGLE_CSE_MAX_START = 21; // 3 pages of 10 results per query

export function googleCseUrl(apiKey, cseId, query, start = 1) {
    return 'https://www.googleapis.com/customsearch/v1'
        + `?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}`
        + `&q=${encodeURIComponent(query)}&num=10${start > 1 ? `&start=${start}` : ''}`;
}

function googleSearchRequest(input, kind, query, source, start = 1) {
    return {
        url: googleCseUrl(input.googleApiKey, input.googleCseId, query, start),
        label: LABELS.GOOGLE_SEARCH,
        uniqueKey: `gcse:${kind}:${query}:${start}`,
        userData: { label: LABELS.GOOGLE_SEARCH, kind, query, source, start },
    };
}

/**
 * Build initial Google CSE requests for both pipelines (respecting the
 * discovery mode). Returns [] when no API key/CSE ID is configured.
 */
export function buildGoogleSearchRequests(input) {
    if (!input.googleApiKey || !input.googleCseId) return [];
    const requests = [];
    const locs = input.locations.length ? input.locations : [''];
    const mode = input.discoveryMode;

    for (const term of input.searchTerms) {
        for (const loc of locs) {
            if (mode === 'instagram-first' || mode === 'both') {
                const source = { discoveryMethod: 'search', searchTerm: term, locationQuery: loc || null };
                for (const variant of buildQueryVariants(term)) {
                    const query = `site:instagram.com ${variant}${loc ? ` ${loc}` : ''}`;
                    requests.push(googleSearchRequest(input, 'profiles', query, source));
                }
            }
            if (mode === 'shopify-first' || mode === 'both') {
                const source = { discoveryMethod: 'shopify-first', searchTerm: term, locationQuery: loc || null };
                for (const query of buildStoreQueries(term, loc)) {
                    requests.push(googleSearchRequest(input, 'stores', query, source));
                }
            }
        }
    }
    return requests;
}

/** Next CSE page for the same query, or null at the page limit. */
export function nextGooglePageRequest(input, { kind, query, source, start = 1 }) {
    const nextStart = start + 10;
    if (nextStart > GOOGLE_CSE_MAX_START) return null;
    return googleSearchRequest(input, kind, query, source, nextStart);
}

/** Result links from a CSE JSON response. */
export function extractLinksFromCse(json) {
    return (Array.isArray(json?.items) ? json.items : [])
        .map((item) => item?.link)
        .filter((link) => typeof link === 'string');
}
