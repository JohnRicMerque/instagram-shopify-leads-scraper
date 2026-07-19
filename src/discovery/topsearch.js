/**
 * Discovery via Instagram's own public keyword search (topsearch).
 * Returns actual accounts for a niche query — the highest-precision
 * discovery source when Instagram serves it anonymously. Login-walled
 * from some IP pools, so it is best-effort: search engines remain the
 * backbone and nothing depends on this succeeding.
 */

/** Extract usernames from a topsearch API response. */
export function extractUsernamesFromTopsearch(json) {
    const users = Array.isArray(json?.users) ? json.users : [];
    const usernames = new Set();
    for (const entry of users) {
        const username = entry?.user?.username;
        if (username) usernames.add(String(username).toLowerCase());
    }
    return [...usernames];
}

/** Does this topsearch response look login-walled or malformed? */
export function isTopsearchBlocked(json) {
    if (!json || typeof json !== 'object') return true;
    if (json.require_login === true) return true;
    if (json.status === 'fail') return true;
    return !Array.isArray(json.users);
}
