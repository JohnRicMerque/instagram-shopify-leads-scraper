/**
 * Discovery pipeline: turns the Actor input into the initial set of
 * crawler requests. Each discovery mode is a separate, replaceable module.
 *
 * Modes and their auth requirements:
 *  - Direct profile URLs / usernames ........ no auth needed
 *  - Search-engine discovery (DuckDuckGo,
 *    Bing "site:instagram.com" queries) ..... no auth needed
 *  - Instagram hashtag API .................. often login-walled; optional
 *    session cookies improve coverage; falls back to search engines
 */
import { LABELS, IG_PROFILE_API, IG_HASHTAG_API, IG_TOPSEARCH_API } from '../constants.js';
import { buildSearchRequests, buildHashtagFallbackRequests } from './search-engine.js';
import { buildStoreSearchRequests } from './store-search.js';
import { buildGoogleSearchRequests } from './google-cse.js';

/** Request that fetches one profile through the public web-profile API. */
export function profileRequest(username, source = {}) {
    return {
        url: IG_PROFILE_API(username),
        label: LABELS.PROFILE,
        uniqueKey: `profile:${username}`,
        userData: { label: LABELS.PROFILE, username, source },
    };
}

/** Request against Instagram's own public keyword search (best-effort). */
export function topsearchRequest(query, source) {
    return {
        url: IG_TOPSEARCH_API(query),
        label: LABELS.TOPSEARCH,
        uniqueKey: `topsearch:${query.toLowerCase()}`,
        userData: { label: LABELS.TOPSEARCH, query, source },
    };
}

export function hashtagRequest(tag) {
    return {
        url: IG_HASHTAG_API(tag),
        label: LABELS.HASHTAG,
        uniqueKey: `hashtag:${tag}`,
        userData: { label: LABELS.HASHTAG, hashtag: tag },
    };
}

/**
 * Build the initial request list from parsed input.
 * Direct usernames become PROFILE requests immediately; search terms and
 * hashtags become SEARCH / HASHTAG discovery requests.
 */
export function buildInitialRequests(input) {
    const requests = [];

    for (const username of input.usernames) {
        if (input.excludedUsernames.has(username)) continue;
        requests.push(profileRequest(username, { discoveryMethod: 'direct' }));
    }

    const mode = input.discoveryMode ?? 'both';

    if (mode === 'instagram-first' || mode === 'both') {
        requests.push(...buildSearchRequests(input.searchTerms, input.locations));

        // Instagram's own search, per term × location (best-effort, no login).
        const locs = input.locations.length ? input.locations : [''];
        for (const term of input.searchTerms) {
            for (const loc of locs) {
                const query = `${term}${loc ? ` ${loc}` : ''}`;
                requests.push(topsearchRequest(query, {
                    discoveryMethod: 'instagram-search',
                    searchTerm: term,
                    locationQuery: loc || null,
                }));
            }
        }
    }

    if (mode === 'shopify-first' || mode === 'both') {
        requests.push(...buildStoreSearchRequests(input.searchTerms, input.locations));
    }

    // Optional Google Custom Search (only when the user supplied a key).
    requests.push(...buildGoogleSearchRequests(input));

    for (const tag of input.hashtags) {
        requests.push(hashtagRequest(tag));
    }

    return requests;
}

export { buildHashtagFallbackRequests };
