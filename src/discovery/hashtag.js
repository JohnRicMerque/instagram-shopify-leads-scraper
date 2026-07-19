/**
 * Instagram hashtag discovery via the public tags web-info API.
 * Frequently login-walled for anonymous visitors; the caller falls back to
 * search-engine discovery when this returns nothing.
 */

/**
 * Extract usernames from a tags/web_info API response.
 * The payload shape has changed over the years, so this walks all known
 * section layouts defensively.
 * @param {object} json parsed API response
 * @returns {string[]} usernames
 */
export function extractUsernamesFromHashtagResponse(json) {
    const usernames = new Set();
    const data = json?.data ?? json;

    const sectionGroups = [
        data?.top?.sections,
        data?.recent?.sections,
        data?.hashtag?.edge_hashtag_to_media?.edges,
        data?.hashtag?.edge_hashtag_to_top_posts?.edges,
    ];

    for (const group of sectionGroups) {
        if (!Array.isArray(group)) continue;
        for (const item of group) {
            // sections[] -> layout_content.medias[] -> media.user.username
            const medias = item?.layout_content?.medias
                ?? item?.layout_content?.one_by_two_item?.clips?.items
                ?? [];
            for (const media of medias) {
                const username = media?.media?.user?.username ?? media?.media?.owner?.username;
                if (username) usernames.add(String(username).toLowerCase());
            }
            // GraphQL edges -> node.owner.username
            const owner = item?.node?.owner?.username;
            if (owner) usernames.add(String(owner).toLowerCase());
        }
    }

    return [...usernames];
}

/** Heuristic: does this hashtag API response look login-walled or empty? */
export function isHashtagResponseBlocked(json) {
    if (!json || typeof json !== 'object') return true;
    if (json.require_login === true) return true;
    if (json.status === 'fail') return true;
    return false;
}
