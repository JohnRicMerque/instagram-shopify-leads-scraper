/**
 * Lead lifecycle: creation, best-website selection, final row assembly,
 * and filtering. The lead store itself lives in Actor.useState (main.js)
 * so partial results survive migrations and aborted runs.
 */
import { normalizeDomain } from './utils/normalize.js';
import { scoreLead } from './scoring/score.js';

// `username` may be null for store-only leads discovered from the website
// side when the store exposes no Instagram link.
export function createLead(username, source = {}) {
    return {
        username: username ?? null,
        source,
        status: 'pending', // pending -> profile_done | no_website | website_pending -> done/filtered/failed
        profile: null,
        activity: null,
        originalBioUrl: null,
        bioLinkService: null,
        websiteCandidates: [],
        filterReason: null,
        error: null,
    };
}

/** Pick the best website candidate: Shopify > has store > reachable > first. */
export function chooseBestCandidate(candidates) {
    if (!candidates?.length) return null;
    return [...candidates].sort((a, b) => (Number(b.isShopify ?? false) - Number(a.isShopify ?? false))
        || (Number(b.hasOnlineStore ?? false) - Number(a.hasOnlineStore ?? false))
        || ((b.shopifyConfidence ?? 0) - (a.shopifyConfidence ?? 0))
        || (Number(b.reachable ?? false) - Number(a.reachable ?? false)))[0];
}

/**
 * Assemble the final dataset row for one lead and score it.
 * Contact priority: Instagram public business fields, then website
 * header/footer, then contact page (already merged into candidate.contact).
 */
export function buildRow(lead, input, now = Date.now()) {
    const profile = lead.profile ?? {};
    const activity = lead.activity ?? {};
    const best = chooseBestCandidate(lead.websiteCandidates);
    const contact = best?.contact ?? {};

    let websitePlatform;
    if (best) {
        websitePlatform = best.reachable === false ? 'Unreachable' : (best.platform ?? 'Unknown');
    } else if (lead.originalBioUrl) {
        // A bio link existed but no candidate page could be loaded.
        websitePlatform = lead.status === 'website_pending' || lead.websiteFailed ? 'Unreachable' : 'Unknown';
    } else {
        websitePlatform = 'No website';
    }

    const resolvedStoreUrl = best?.reachable === false ? null : (best?.finalUrl ?? best?.url ?? null);

    const row = {
        searchTerm: lead.source?.searchTerm ?? null,
        locationQuery: lead.source?.locationQuery ?? null,
        discoveryMethod: lead.source?.discoveryMethod ?? null,
        instagramUrl: profile.instagramUrl
            ?? (lead.username ? `https://www.instagram.com/${lead.username}/` : null),
        username: lead.username ?? null,
        fullName: profile.fullName ?? null,
        biography: profile.biography ?? null,
        category: profile.category ?? null,
        isBusinessAccount: profile.isBusinessAccount ?? null,
        isProfessionalAccount: profile.isProfessionalAccount ?? null,
        isVerified: profile.isVerified ?? null,
        followersCount: profile.followersCount ?? null,
        followingCount: profile.followingCount ?? null,
        postsCount: profile.postsCount ?? null,
        profileImageUrl: profile.profileImageUrl ?? null,
        latestPostDate: activity.latestPostDate ?? null,
        postsLast30Days: activity.postsLast30Days ?? null,
        averageLikes: activity.averageLikes ?? null,
        averageComments: activity.averageComments ?? null,
        averageEngagementRate: activity.averageEngagementRate ?? null,
        isActive: activity.isActive ?? null,
        contentTypes: activity.contentTypes ?? [],
        recentCaptions: activity.recentCaptions ?? [],
        recentHashtags: activity.recentHashtags ?? [],
        originalBioUrl: lead.originalBioUrl ?? null,
        bioLinkService: lead.bioLinkService ?? null,
        resolvedStoreUrl,
        websiteDomain: resolvedStoreUrl ? normalizeDomain(resolvedStoreUrl) : null,
        websitePlatform,
        isShopify: best?.isShopify ?? false,
        shopifyConfidence: best?.shopifyConfidence ?? 0,
        shopifySignals: best?.shopifySignals ?? [],
        hasOnlineStore: best?.hasOnlineStore ?? false,
        websiteReachable: best ? best.reachable !== false : false,
        websiteUsesHttps: resolvedStoreUrl ? resolvedStoreUrl.startsWith('https:') : null,
        productCount: best?.productCount ?? null,
        detectedApps: best?.detectedApps ?? [],
        storeCurrency: best?.storeCurrency ?? null,
        emailVerified: null,
        publicEmail: profile.publicEmail ?? contact.emails?.[0] ?? null,
        publicPhone: profile.publicPhone ?? contact.phones?.[0] ?? null,
        contactPageUrl: contact.contactPageUrl ?? null,
        websiteTitle: contact.pageTitle ?? null,
        websiteDescription: contact.metaDescription ?? null,
        websiteBusinessName: contact.businessName ?? null,
        websiteSocialLinks: contact.socialLinks ?? [],
        locationHints: contact.locationHints ?? [],
        scrapedAt: new Date(now).toISOString(),
        error: lead.error ?? null,
    };

    const { leadScore, leadTier, leadReasons } = scoreLead(row, input, now);
    row.leadScore = leadScore;
    row.leadTier = leadTier;
    row.leadReasons = leadReasons;
    return row;
}

/**
 * Apply user filters to a finished row.
 * @returns {string|null} the filter that rejected the row, or null when it passes.
 */
export function filterRow(row, input) {
    if (row.username && input.excludedUsernames.has(row.username)) return 'excluded';
    if (row.websiteDomain && input.excludedDomains.has(row.websiteDomain)) return 'excluded';

    const followers = row.followersCount;
    if (followers != null) {
        if (followers < input.minimumFollowers) return 'followers';
        if (input.maximumFollowers > 0 && followers > input.maximumFollowers) return 'followers';
    }

    if (input.requireShopify && !row.isShopify) return 'notShopify';
    if (input.requireInstagram && !row.username) return 'noInstagram';
    if (input.onlyActiveProfiles && row.isActive !== true) return 'inactive';
    if (input.requireEmail && !row.publicEmail) return 'noEmail';
    if (row.leadScore < input.minimumLeadScore) return 'belowMinScore';

    if (input.strictLocationFilter && input.locations.length) {
        const haystack = [
            row.biography, row.websiteTitle, row.websiteDescription,
            row.category, ...(row.locationHints ?? []),
        ].filter(Boolean).join(' ').toLowerCase();
        const matched = input.locations.some((loc) => haystack.includes(loc.toLowerCase()));
        if (!matched) return 'location';
    }

    return null;
}
