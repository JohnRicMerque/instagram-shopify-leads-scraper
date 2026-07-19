/**
 * Transparent lead scoring (0–100) with human-readable reasons.
 *
 * Commerce fit ....... 35 pts (Shopify +30 | store-but-uncertain +15; reachable +5)
 * Contactability ..... 25 pts (email +15, phone +5, contact page +5)
 * Instagram activity . 25 pts (posted <7d +15 | <30d +8; engagement up to +10)
 * Business quality ... 15 pts (professional +5, complete bio+website +5,
 *                              followers in target range +5)
 */
import { daysSince } from '../instagram/activity.js';

function engagementPoints(rate) {
    if (rate == null) return 0;
    if (rate >= 3) return 10;
    if (rate >= 1.5) return 7;
    if (rate >= 0.5) return 4;
    if (rate >= 0.1) return 2;
    return 0;
}

/**
 * @param {object} lead assembled lead row (pre-scoring fields set)
 * @param {object} input parsed Actor input (for the follower target range)
 * @param {number} [now] injectable clock for tests
 * @returns {{ leadScore: number, leadTier: string, leadReasons: string[] }}
 */
export function scoreLead(lead, input, now = Date.now()) {
    let score = 0;
    const reasons = [];

    // --- Commerce fit (max 35) ---
    let commerce = 0;
    if (lead.isShopify) {
        commerce += 30;
        reasons.push('Confirmed Shopify store');
    } else if (lead.hasOnlineStore) {
        commerce += 15;
        reasons.push('Online store detected but platform uncertain');
    }
    if (lead.websiteReachable) {
        commerce += 5;
        reasons.push('Store website is reachable');
    }
    score += Math.min(35, commerce);

    // --- Contactability (max 25) ---
    let contact = 0;
    if (lead.publicEmail) {
        contact += 15;
        reasons.push('Public business email available');
    }
    if (lead.publicPhone) {
        contact += 5;
        reasons.push('Public telephone number available');
    }
    if (lead.contactPageUrl) {
        contact += 5;
        reasons.push('Contact page found');
    }
    score += Math.min(25, contact);

    // --- Instagram activity (max 25) ---
    let activity = 0;
    const days = daysSince(lead.latestPostDate, now);
    if (days != null && days <= 7) {
        activity += 15;
        reasons.push('Instagram profile posted within the last seven days');
    } else if (days != null && days <= 30) {
        activity += 8;
        reasons.push('Instagram profile posted within the last thirty days');
    }
    const engPts = engagementPoints(lead.averageEngagementRate);
    if (engPts > 0) {
        activity += engPts;
        reasons.push(engPts >= 7
            ? `Healthy engagement rate (${lead.averageEngagementRate}%)`
            : `Engagement activity detected (${lead.averageEngagementRate}%)`);
    }
    score += Math.min(25, activity);

    // --- Business quality (max 15) ---
    let quality = 0;
    if (lead.isProfessionalAccount || lead.isBusinessAccount) {
        quality += 5;
        reasons.push('Professional Instagram account');
    }
    if (lead.biography && (lead.resolvedStoreUrl || lead.originalBioUrl)) {
        quality += 5;
        reasons.push('Complete biography and website link');
    }
    const followers = lead.followersCount;
    const min = input?.minimumFollowers ?? 0;
    const max = input?.maximumFollowers || Infinity;
    if (followers != null && followers >= min && followers <= max) {
        quality += 5;
        reasons.push('Follower count within target range');
    }
    score += Math.min(15, quality);

    const leadScore = Math.min(100, Math.round(score));
    return { leadScore, leadTier: tierFor(leadScore), leadReasons: reasons };
}

export function tierFor(score) {
    if (score >= 75) return 'High';
    if (score >= 45) return 'Medium';
    return 'Low';
}
