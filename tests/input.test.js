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
    assert.equal(input.requireShopify, false, 'Shopify-only filter is opt-in');
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
    const all = parseInput({ searchTerms: ['x'] });
    assert.equal(all.leadType, 'all');
    assert.equal(all.requireShopify, false);
    assert.equal(all.requireInstagram, false);

    const shopify = parseInput({ searchTerms: ['x'], leadType: 'shopify' });
    assert.equal(shopify.requireShopify, true);
    assert.equal(shopify.discoveryMode, 'shopify-first', 'shopify leads use store-first discovery');

    const instagram = parseInput({ searchTerms: ['x'], leadType: 'instagram' });
    assert.equal(instagram.requireInstagram, true);
    assert.equal(instagram.requireShopify, false);

    assert.equal(parseInput({ searchTerms: ['x'], leadType: 'bogus' }).leadType, 'all');
    assert.equal(parseInput({ searchTerms: ['x'], resetLeadsHistory: true }).resetLeadsHistory, true);
    assert.equal(parseInput({ searchTerms: ['x'] }).includeIncompleteLeads, false);
    assert.equal(parseInput({ searchTerms: ['x'], includeIncompleteLeads: true }).includeIncompleteLeads, true);
});

test('discoveryMode: auto resolves from requireShopify, explicit values honored', () => {
    // Default: requireShopify off -> both pipelines.
    assert.equal(parseInput({ searchTerms: ['x'] }).discoveryMode, 'both');
    // Shopify-only runs go store-first.
    assert.equal(parseInput({ searchTerms: ['x'], requireShopify: true }).discoveryMode, 'shopify-first');
    // Explicit choices win over auto.
    assert.equal(parseInput({ searchTerms: ['x'], discoveryMode: 'instagram-first' }).discoveryMode, 'instagram-first');
    assert.equal(parseInput({ searchTerms: ['x'], requireShopify: true, discoveryMode: 'both' }).discoveryMode, 'both');
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
