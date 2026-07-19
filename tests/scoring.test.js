import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, tierFor } from '../src/scoring/score.js';

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const baseInput = { minimumFollowers: 500, maximumFollowers: 500000 };

function baseLead(overrides = {}) {
    return {
        isShopify: false,
        hasOnlineStore: false,
        websiteReachable: false,
        publicEmail: null,
        publicPhone: null,
        contactPageUrl: null,
        latestPostDate: null,
        averageEngagementRate: null,
        isBusinessAccount: false,
        isProfessionalAccount: false,
        biography: null,
        resolvedStoreUrl: null,
        originalBioUrl: null,
        followersCount: null,
        ...overrides,
    };
}

test('strong Shopify lead scores High with readable reasons', () => {
    const lead = baseLead({
        isShopify: true,
        websiteReachable: true,
        publicEmail: 'hello@examplebrand.com',
        contactPageUrl: 'https://examplebrand.com/pages/contact',
        latestPostDate: new Date(NOW - 2 * DAY).toISOString(),
        averageEngagementRate: 2.92,
        isProfessionalAccount: true,
        biography: 'Independent skincare brand',
        resolvedStoreUrl: 'https://examplebrand.com',
        followersCount: 18400,
    });
    const { leadScore, leadTier, leadReasons } = scoreLead(lead, baseInput, NOW);
    // 35 commerce + 20 contact + 22 activity + 15 quality = 92
    assert.equal(leadScore, 92);
    assert.equal(leadTier, 'High');
    assert.ok(leadReasons.includes('Confirmed Shopify store'));
    assert.ok(leadReasons.includes('Public business email available'));
    assert.ok(leadReasons.includes('Instagram profile posted within the last seven days'));
    assert.ok(leadReasons.includes('Professional Instagram account'));
});

test('score never exceeds 100 and is capped per category', () => {
    const lead = baseLead({
        isShopify: true,
        hasOnlineStore: true,
        websiteReachable: true,
        publicEmail: 'a@b.co',
        publicPhone: '+1 555 000 1111',
        contactPageUrl: 'https://x.com/contact',
        latestPostDate: new Date(NOW - 1 * DAY).toISOString(),
        averageEngagementRate: 9.9,
        isBusinessAccount: true,
        isProfessionalAccount: true,
        biography: 'bio',
        resolvedStoreUrl: 'https://x.com',
        followersCount: 10000,
    });
    const { leadScore } = scoreLead(lead, baseInput, NOW);
    assert.equal(leadScore, 100);
});

test('uncertain store platform earns partial commerce points', () => {
    const shopifyOnly = scoreLead(baseLead({ isShopify: true }), baseInput, NOW);
    const uncertain = scoreLead(baseLead({ hasOnlineStore: true }), baseInput, NOW);
    const nothing = scoreLead(baseLead(), baseInput, NOW);
    assert.equal(shopifyOnly.leadScore, 30);
    assert.equal(uncertain.leadScore, 15);
    assert.equal(nothing.leadScore, 0);
});

test('30-day activity earns fewer points than 7-day activity', () => {
    const recent = scoreLead(baseLead({ latestPostDate: new Date(NOW - 3 * DAY).toISOString() }), baseInput, NOW);
    const stale = scoreLead(baseLead({ latestPostDate: new Date(NOW - 20 * DAY).toISOString() }), baseInput, NOW);
    const dead = scoreLead(baseLead({ latestPostDate: new Date(NOW - 90 * DAY).toISOString() }), baseInput, NOW);
    assert.equal(recent.leadScore, 15);
    assert.equal(stale.leadScore, 8);
    assert.equal(dead.leadScore, 0);
});

test('followers outside target range earn no range bonus', () => {
    const inRange = scoreLead(baseLead({ followersCount: 1000 }), baseInput, NOW);
    const outOfRange = scoreLead(baseLead({ followersCount: 100 }), baseInput, NOW);
    assert.equal(inRange.leadScore, 5);
    assert.equal(outOfRange.leadScore, 0);
});

test('tier boundaries', () => {
    assert.equal(tierFor(75), 'High');
    assert.equal(tierFor(74), 'Medium');
    assert.equal(tierFor(45), 'Medium');
    assert.equal(tierFor(44), 'Low');
    assert.equal(tierFor(0), 'Low');
});
