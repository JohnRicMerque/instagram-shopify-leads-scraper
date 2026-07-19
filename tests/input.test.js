import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../src/input.js';

test('throws when no discovery source is provided', () => {
    assert.throws(() => parseInput({}), /No discovery source/);
    assert.throws(() => parseInput({ searchTerms: [], hashtags: ['   '] }), /No discovery source/);
});

test('normalizes hashtags, usernames, and start URLs', () => {
    const input = parseInput({
        hashtags: ['#SkincareBrand', 'jewelry!', ''],
        usernames: ['@Foo', 'foo'],
        startUrls: [{ url: 'https://www.instagram.com/BarShop/' }, 'https://www.instagram.com/p/Cxyz/'],
    });
    assert.deepEqual(input.hashtags, ['skincarebrand', 'jewelry']);
    assert.deepEqual(input.usernames.sort(), ['barshop', 'foo']);
});

test('applies defaults and clamps numeric values', () => {
    const input = parseInput({ searchTerms: ['skincare'], maxResults: 999999, recentPostsToAnalyze: 50 });
    assert.equal(input.maxResults, 5000);
    assert.equal(input.recentPostsToAnalyze, 12);
    assert.equal(input.minimumFollowers, 0);
    assert.equal(input.requireShopify, true, 'default lead type requires a Shopify store');
    assert.equal(input.requireInstagram, true, 'default lead type requires Instagram');
    assert.equal(input.expandDiscovery, true, 'discovery expansion is on by default');
    assert.equal(input.includeContactDetails, true);
    assert.equal(input.maxConcurrency, 5);
    assert.ok(input.discoveryCap >= input.maxResults);
});

test('technical fields remain overridable via API input', () => {
    const input = parseInput({
        searchTerms: ['x'], requireShopify: true, expandDiscovery: false, recentPostsToAnalyze: 4, maxConcurrency: 10,
    });
    assert.equal(input.requireShopify, true);
    assert.equal(input.expandDiscovery, false);
    assert.equal(input.recentPostsToAnalyze, 4);
    assert.equal(input.maxConcurrency, 10);
});

test('leadType maps to the right filters', () => {
    // Default: the core promise — Shopify store AND Instagram account.
    const def = parseInput({ searchTerms: ['x'] });
    assert.equal(def.leadType, 'shopify-instagram');
    assert.equal(def.requireShopify, true);
    assert.equal(def.requireInstagram, true);
    assert.equal(def.discoveryMode, 'both', 'Instagram requirement keeps both pipelines running');

    const shopify = parseInput({ searchTerms: ['x'], leadType: 'shopify' });
    assert.equal(shopify.requireShopify, true);
    assert.equal(shopify.requireInstagram, false);
    assert.equal(shopify.discoveryMode, 'shopify-first', 'Shopify-only leads use store-first discovery');

    const instagram = parseInput({ searchTerms: ['x'], leadType: 'instagram' });
    assert.equal(instagram.requireInstagram, true);
    assert.equal(instagram.requireShopify, false);

    const all = parseInput({ searchTerms: ['x'], leadType: 'all' });
    assert.equal(all.requireShopify, false);
    assert.equal(all.requireInstagram, false);

    assert.equal(parseInput({ searchTerms: ['x'], leadType: 'bogus' }).leadType, 'shopify-instagram');
    assert.equal(parseInput({ searchTerms: ['x'], resetLeadsHistory: true }).resetLeadsHistory, true);
    assert.equal(parseInput({ searchTerms: ['x'] }).includeIncompleteLeads, false);
    assert.equal(parseInput({ searchTerms: ['x'], includeIncompleteLeads: true }).includeIncompleteLeads, true);
});

test('discoveryMode: auto resolves from lead requirements, explicit values honored', () => {
    // Default (Shopify + Instagram required) -> both pipelines contribute.
    assert.equal(parseInput({ searchTerms: ['x'] }).discoveryMode, 'both');
    // Shopify-only (Instagram not required) is served best by store-first alone.
    assert.equal(parseInput({ searchTerms: ['x'], leadType: 'shopify' }).discoveryMode, 'shopify-first');
    // Explicit choices win over auto.
    assert.equal(parseInput({ searchTerms: ['x'], discoveryMode: 'instagram-first' }).discoveryMode, 'instagram-first');
    assert.equal(parseInput({ searchTerms: ['x'], leadType: 'shopify', discoveryMode: 'both' }).discoveryMode, 'both');
    // Invalid values fall back to auto resolution.
    assert.equal(parseInput({ searchTerms: ['x'], discoveryMode: 'bogus' }).discoveryMode, 'both');
});

test('parses exclusion lists into normalized sets', () => {
    const input = parseInput({
        searchTerms: ['x'],
        excludedUsernames: ['@Skip.Me'],
        excludedDomains: ['https://www.SkipDomain.com'],
    });
    assert.ok(input.excludedUsernames.has('skip.me'));
    assert.ok(input.excludedDomains.has('skipdomain.com'));
});
