import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLead, chooseBestCandidate, buildRow, filterRow } from '../src/leads.js';
import { parseInput } from '../src/input.js';

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const input = parseInput({ searchTerms: ['skincare'], minimumFollowers: 500, maximumFollowers: 500000 });

function shopifyCandidate(overrides = {}) {
    return {
        url: 'https://linktr.ee/examplebrand',
        finalUrl: 'https://examplebrand.com/',
        domain: 'examplebrand.com',
        reachable: true,
        platform: 'Shopify',
        isShopify: true,
        shopifyConfidence: 0.98,
        shopifySignals: ['cdn.shopify.com asset detected'],
        hasOnlineStore: true,
        productCount: 42,
        contact: { emails: ['hello@examplebrand.com'], phones: [], contactPageUrl: 'https://examplebrand.com/pages/contact' },
        ...overrides,
    };
}

function fullLead() {
    const lead = createLead('examplebrand', { discoveryMethod: 'search', searchTerm: 'skincare brands', locationQuery: 'United Kingdom' });
    lead.profile = {
        username: 'examplebrand',
        instagramUrl: 'https://www.instagram.com/examplebrand/',
        fullName: 'Example Brand',
        biography: 'Independent skincare brand',
        category: 'Health/beauty',
        isBusinessAccount: true,
        isProfessionalAccount: true,
        isVerified: false,
        followersCount: 18400,
        followingCount: 420,
        postsCount: 386,
        externalUrl: 'https://linktr.ee/examplebrand',
        publicEmail: null,
        publicPhone: null,
        profileImageUrl: null,
    };
    lead.activity = {
        latestPostDate: new Date(NOW - 2 * 86400000).toISOString(),
        postsLast30Days: 9,
        averageLikes: 510,
        averageComments: 28,
        averageEngagementRate: 2.92,
        isActive: true,
        contentTypes: ['image'],
        recentCaptions: [],
        recentHashtags: [],
    };
    lead.originalBioUrl = 'https://linktr.ee/examplebrand';
    lead.bioLinkService = 'Linktree';
    lead.websiteCandidates = [shopifyCandidate()];
    return lead;
}

test('buildRow assembles a complete scored row', () => {
    const row = buildRow(fullLead(), input, NOW);
    assert.equal(row.username, 'examplebrand');
    assert.equal(row.searchTerm, 'skincare brands');
    assert.equal(row.locationQuery, 'United Kingdom');
    assert.equal(row.originalBioUrl, 'https://linktr.ee/examplebrand');
    assert.equal(row.resolvedStoreUrl, 'https://examplebrand.com/');
    assert.equal(row.websiteDomain, 'examplebrand.com');
    assert.equal(row.websitePlatform, 'Shopify');
    assert.equal(row.isShopify, true);
    assert.equal(row.publicEmail, 'hello@examplebrand.com');
    assert.equal(row.contactPageUrl, 'https://examplebrand.com/pages/contact');
    assert.equal(row.productCount, 42);
    assert.equal(row.websiteUsesHttps, true);
    assert.equal(row.leadTier, 'High');
    assert.ok(row.leadScore >= 75);
    assert.ok(Array.isArray(row.leadReasons) && row.leadReasons.length > 0);
    assert.equal(row.error, null);
});

test('Instagram business email takes priority over website email', () => {
    const lead = fullLead();
    lead.profile.publicEmail = 'business@examplebrand.com';
    const row = buildRow(lead, input, NOW);
    assert.equal(row.publicEmail, 'business@examplebrand.com');
});

test('unreachable website is reported as Unreachable with null store URL', () => {
    const lead = fullLead();
    lead.websiteCandidates = [shopifyCandidate({
        reachable: false, isShopify: false, platform: 'Unreachable', shopifyConfidence: 0, shopifySignals: [], hasOnlineStore: false, contact: {},
    })];
    const row = buildRow(lead, input, NOW);
    assert.equal(row.websitePlatform, 'Unreachable');
    assert.equal(row.resolvedStoreUrl, null);
    assert.equal(row.isShopify, false);
});

test('profile without bio link is reported as No website', () => {
    const lead = fullLead();
    lead.originalBioUrl = null;
    lead.websiteCandidates = [];
    const row = buildRow(lead, input, NOW);
    assert.equal(row.websitePlatform, 'No website');
    assert.equal(row.resolvedStoreUrl, null);
});

test('chooseBestCandidate prefers Shopify over reachable-but-unknown', () => {
    const unknown = shopifyCandidate({ isShopify: false, platform: 'Unknown', shopifyConfidence: 0, finalUrl: 'https://other.com/' });
    const shopify = shopifyCandidate();
    assert.equal(chooseBestCandidate([unknown, shopify]).finalUrl, 'https://examplebrand.com/');
    assert.equal(chooseBestCandidate([]), null);
});

test('store-only lead (no Instagram) builds a valid scored row', () => {
    const lead = createLead(null, { discoveryMethod: 'shopify-first', searchTerm: 'skincare', locationQuery: null });
    lead.status = 'done';
    lead.websiteCandidates = [shopifyCandidate()];
    const row = buildRow(lead, input, NOW);
    assert.equal(row.username, null);
    assert.equal(row.instagramUrl, null);
    assert.equal(row.websitePlatform, 'Shopify');
    assert.equal(row.isShopify, true);
    assert.equal(row.publicEmail, 'hello@examplebrand.com');
    assert.ok(row.leadScore > 0);
    // Null username must not trip the exclusion filter.
    const excludedInput = parseInput({ searchTerms: ['x'], excludedUsernames: ['someone'] });
    assert.notEqual(filterRow(row, excludedInput), 'excluded');
    // "With Instagram only" rejects store-only rows.
    const igOnlyInput = parseInput({ searchTerms: ['x'], leadType: 'instagram' });
    assert.equal(filterRow(row, igOnlyInput), 'noInstagram');
});

test('filterRow enforces user filters', () => {
    const row = buildRow(fullLead(), input, NOW);
    assert.equal(filterRow(row, input), null);

    const nonShopify = { ...row, isShopify: false };
    assert.equal(filterRow(nonShopify, input), null, 'non-Shopify leads pass by default');
    const shopifyOnlyInput = parseInput({ searchTerms: ['x'], requireShopify: true });
    assert.equal(filterRow(nonShopify, shopifyOnlyInput), 'notShopify');

    const tooSmall = { ...row, followersCount: 10 };
    assert.equal(filterRow(tooSmall, input), 'followers');

    const excludedInput = parseInput({ searchTerms: ['x'], excludedDomains: ['examplebrand.com'] });
    assert.equal(filterRow(row, excludedInput), 'excluded');

    const emailInput = parseInput({ searchTerms: ['x'], requireEmail: true });
    assert.equal(filterRow({ ...row, publicEmail: null }, emailInput), 'noEmail');

    const strictInput = parseInput({ searchTerms: ['x'], locations: ['Iceland'], strictLocationFilter: true, requireShopify: false });
    assert.equal(filterRow({ ...row, isShopify: false }, strictInput), 'location');
});
