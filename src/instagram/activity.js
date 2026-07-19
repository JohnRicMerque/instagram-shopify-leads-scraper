/**
 * Recent-activity analysis from the timeline media embedded in the
 * web-profile-info response (Instagram exposes up to 12 recent posts).
 * Returns null-valued metrics when data is unavailable — never invents
 * or estimates hidden numbers.
 */
import { extractHashtags, snippet } from '../utils/text.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const TYPE_MAP = {
    GraphImage: 'image',
    GraphVideo: 'video',
    GraphSidecar: 'carousel',
};

function average(values) {
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * @param {object} user `data.user` from web_profile_info
 * @param {number} postsToAnalyze how many recent posts to include (0–12)
 * @param {number} [now] injectable clock for tests (ms epoch)
 */
export function analyzeActivity(user, postsToAnalyze, now = Date.now()) {
    const edges = user?.edge_owner_to_timeline_media?.edges;
    const followers = user?.edge_followed_by?.count ?? null;

    const empty = {
        latestPostDate: null,
        postsLast30Days: null,
        averageLikes: null,
        averageComments: null,
        averageEngagementRate: null,
        isActive: null,
        contentTypes: [],
        recentCaptions: [],
        recentHashtags: [],
        analyzedPostsCount: 0,
    };

    if (!Array.isArray(edges) || edges.length === 0 || postsToAnalyze === 0) return empty;

    const posts = edges
        .slice(0, postsToAnalyze)
        .map((edge) => edge?.node)
        .filter(Boolean);
    if (!posts.length) return empty;

    const timestamps = posts
        .map((p) => (Number.isFinite(p.taken_at_timestamp) ? p.taken_at_timestamp * 1000 : null))
        .filter((t) => t != null);

    const likes = posts
        .map((p) => p.edge_liked_by?.count ?? p.edge_media_preview_like?.count ?? null)
        .filter((n) => Number.isFinite(n) && n >= 0); // hidden like counts come back as -1
    const comments = posts
        .map((p) => p.edge_media_to_comment?.count ?? null)
        .filter((n) => Number.isFinite(n) && n >= 0);

    const averageLikes = average(likes);
    const averageComments = average(comments);

    let averageEngagementRate = null;
    if (averageLikes != null && followers > 0) {
        const perPost = averageLikes + (averageComments ?? 0);
        averageEngagementRate = Math.round((perPost / followers) * 100 * 100) / 100;
    }

    const latestMs = timestamps.length ? Math.max(...timestamps) : null;
    const contentTypes = [...new Set(
        posts.map((p) => TYPE_MAP[p.__typename] ?? (p.is_video ? 'video' : null)).filter(Boolean),
    )];

    const captions = posts
        .map((p) => p.edge_media_to_caption?.edges?.[0]?.node?.text)
        .filter(Boolean);

    return {
        latestPostDate: latestMs ? new Date(latestMs).toISOString() : null,
        postsLast30Days: timestamps.length
            ? timestamps.filter((t) => now - t <= 30 * DAY_MS).length
            : null,
        averageLikes,
        averageComments,
        averageEngagementRate,
        isActive: latestMs != null ? now - latestMs <= 30 * DAY_MS : null,
        contentTypes,
        recentCaptions: captions.slice(0, 3).map((c) => snippet(c)),
        recentHashtags: [...new Set(captions.flatMap((c) => extractHashtags(c)))].slice(0, 10),
        analyzedPostsCount: posts.length,
    };
}

/** Days since the latest post, or null. */
export function daysSince(dateIso, now = Date.now()) {
    if (!dateIso) return null;
    const ts = Date.parse(dateIso);
    if (!Number.isFinite(ts)) return null;
    return (now - ts) / DAY_MS;
}
