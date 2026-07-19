/**
 * Instagram profile extraction.
 *
 * Primary source: the public web-profile-info API (JSON) that Instagram's
 * own web frontend calls. Fallback: the profile HTML page's OpenGraph meta
 * tags, which still expose follower/following/post counts and the name
 * even when the API is login-walled.
 */
import { unwrapRedirectUrl, parseCompactNumber, toUrl } from '../utils/normalize.js';
import { extractEmails, extractUrlFromText } from '../utils/text.js';
import { IG_PROFILE_URL } from '../constants.js';

/**
 * Parse the `data.user` object of a web_profile_info response into the
 * public profile shape used across the Actor. Missing fields become null.
 */
export function parseProfileApi(user) {
    if (!user || typeof user !== 'object') return null;

    const externalRaw = user.external_url
        || (Array.isArray(user.bio_links) ? user.bio_links.find((l) => l?.url)?.url : null);

    return {
        username: user.username ? String(user.username).toLowerCase() : null,
        instagramUrl: user.username ? IG_PROFILE_URL(String(user.username).toLowerCase()) : null,
        fullName: user.full_name || null,
        biography: user.biography || null,
        category: user.category_name || user.business_category_name || null,
        isBusinessAccount: user.is_business_account === true,
        isProfessionalAccount: user.is_professional_account === true,
        isVerified: user.is_verified === true,
        followersCount: user.edge_followed_by?.count ?? null,
        followingCount: user.edge_follow?.count ?? null,
        postsCount: user.edge_owner_to_timeline_media?.count ?? null,
        externalUrl: externalRaw ? unwrapRedirectUrl(externalRaw) : null,
        publicEmail: user.business_email || null,
        publicPhone: user.business_phone_number || null,
        profileImageUrl: user.profile_pic_url_hd || user.profile_pic_url || null,
        dataSource: 'api',
    };
}

/**
 * Fallback: parse OpenGraph meta tags of a profile HTML page.
 * og:description looks like:
 *   "18.4K Followers, 420 Following, 386 Posts - Example Brand
 *    (@examplebrand) on Instagram: \"bio text\""
 * There is no structured external-URL field here, but many business bios
 * spell out their website or link-in-bio URL in the bio text — recover it
 * (and any bio email) so blocked-API runs still produce usable leads.
 */
export function parseProfileHtml($, username) {
    const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
    const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content') ?? null;

    if (!ogDescription && !ogTitle) return null;

    const counts = ogDescription.match(
        /([\d.,]+[KkMmBb]?)\s+Followers?,\s*([\d.,]+[KkMmBb]?)\s+Following,\s*([\d.,]+[KkMmBb]?)\s+Posts?/i,
    );

    // "Example Brand (@examplebrand)" appears in og:title or og:description.
    let fullName = null;
    const nameMatch = (ogTitle || ogDescription).match(/^(.*?)\s*\(@([a-z0-9._]+)\)/i)
        ?? ogDescription.match(/-\s*(.*?)\s*\(@([a-z0-9._]+)\)/i);
    if (nameMatch) fullName = nameMatch[1].replace(/on Instagram.*$/i, '').trim() || null;

    let biography = null;
    const bioMatch = ogDescription.match(/on Instagram:\s*"([\s\S]*)"\s*$/i);
    if (bioMatch) biography = bioMatch[1].trim() || null;

    return {
        username,
        instagramUrl: IG_PROFILE_URL(username),
        fullName,
        biography,
        category: null,
        isBusinessAccount: null,
        isProfessionalAccount: null,
        isVerified: null,
        followersCount: counts ? parseCompactNumber(counts[1]) : null,
        followingCount: counts ? parseCompactNumber(counts[2]) : null,
        postsCount: counts ? parseCompactNumber(counts[3]) : null,
        externalUrl: extractUrlFromText(biography),
        publicEmail: extractEmails(biography ?? '')[0] ?? null,
        publicPhone: null,
        profileImageUrl: ogImage,
        dataSource: 'html-fallback',
    };
}

/** Does this HTML look like an Instagram login/challenge wall? */
export function isLoginWallHtml(html) {
    if (!html) return true;
    return /loginForm|"require_login"|accounts\/login|not-logged-in|challenge_required/i.test(html)
        && !/og:description/i.test(html);
}

/**
 * Usernames of the "related profiles" Instagram itself suggests on a
 * profile — the strongest source for discovering brands in the same niche
 * whose name does not contain the search keyword. Comes free with the
 * web_profile_info response when Instagram includes it.
 */
export function relatedUsernames(user) {
    const edges = user?.edge_related_profiles?.edges ?? [];
    return edges
        .map((edge) => edge?.node?.username)
        .filter(Boolean)
        .map((username) => String(username).toLowerCase());
}

/** External URL is usable only when it parses and is not an instagram link. */
export function usableExternalUrl(externalUrl) {
    const url = toUrl(externalUrl);
    if (!url) return null;
    const host = url.hostname.toLowerCase();
    if (host.endsWith('instagram.com') || host.endsWith('facebook.com')) return null;
    return url.href;
}
