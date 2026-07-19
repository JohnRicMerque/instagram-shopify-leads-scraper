import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
    buildStoreQueries, buildStoreSearchRequests, nextStoreSearchPageRequest, extractStoreCandidates, matchesNiche,
} from '../src/discovery/store-search.js';
import { SEARCH_ENGINE_BUILDERS, MAX_SEARCH_PAGES } from '../src/constants.js';

test('buildStoreQueries targets Shopify storefront footprints', () => {
    assert.deepEqual(buildStoreQueries('skincare', 'United Kingdom'), [
        '"powered by shopify" skincare United Kingdom',
        'site:myshopify.com skincare United Kingdom',
    ]);
    assert.deepEqual(buildStoreQueries('jewelry', ''), [
        '"powered by shopify" jewelry',
        'site:myshopify.com jewelry',
    ]);
});

test('buildStoreSearchRequests fans out across all engines with source metadata', () => {
    const requests = buildStoreSearchRequests(['skincare'], []);
    const engineCount = Object.keys(SEARCH_ENGINE_BUILDERS).length;
    assert.equal(requests.length, 2 * engineCount);
    for (const req of requests) {
        assert.equal(req.userData.label, 'STORE_SEARCH');
        assert.equal(req.userData.source.discoveryMethod, 'shopify-first');
        assert.equal(req.userData.source.searchTerm, 'skincare');
    }
});

test('nextStoreSearchPageRequest paginates and stops at the limit', () => {
    const userData = { engine: 'bing', query: '"powered by shopify" skincare', source: {}, page: 1 };
    const next = nextStoreSearchPageRequest(userData);
    assert.equal(next.userData.page, 2);
    assert.match(next.url, /first=31/);
    assert.equal(nextStoreSearchPageRequest({ ...userData, page: MAX_SEARCH_PAGES }), null);
});

test('extractStoreCandidates keeps store domains, drops marketplaces/social/search hosts', () => {
    const wrapped = `https://www.bing.com/ck/a?!&&p=x&u=a1${Buffer.from('https://wrappedstore.com/products/serum').toString('base64url')}&ntb=1`;
    const html = `
        <html><body>
            <a href="https://examplebrand.com/collections/all">Example Brand</a>
            <a href="${wrapped}">Wrapped Store</a>
            <a href="https://en.wikipedia.org/wiki/Shopify">Wikipedia</a>
            <a href="https://www.amazon.com/dp/B00X">Amazon</a>
            <a href="https://www.instagram.com/examplebrand/">Instagram</a>
            <a href="https://www.shopify.com/blog/skincare">Shopify blog</a>
            <a href="https://linktr.ee/somebrand">Linktree</a>
            <p>Also seen: https://coolbrand.myshopify.com in a snippet</p>
        </body></html>`;
    const $ = cheerio.load(html);
    const candidates = extractStoreCandidates($, html);
    const domains = candidates.map((c) => c.domain).sort();
    assert.deepEqual(domains, ['coolbrand.myshopify.com', 'examplebrand.com', 'wrappedstore.com']);
    // Deep result URLs are normalized to the homepage.
    const example = candidates.find((c) => c.domain === 'examplebrand.com');
    assert.equal(example.url, 'https://examplebrand.com/');
});

test('matchesNiche keeps on-topic stores, rejects unrelated ones', () => {
    const skincarePage = '<html><title>Cocokind: Clean Skincare</title><body>Our skincare essentials</body></html>';
    const pizzaPage = '<html><title>Dominos Pizza Chile</title><body>Order pizza online, delivery and takeout</body></html>';
    assert.equal(matchesNiche(skincarePage, 'skincare'), true);
    assert.equal(matchesNiche(pizzaPage, 'skincare'), false);
    // Multi-word terms match on any meaningful token; stopwords are ignored.
    assert.equal(matchesNiche('<body>Premium fitness gear</body>', 'fitness apparel'), true);
    assert.equal(matchesNiche('<body>We sell the best shoes</body>', 'skincare brands'), false, '"brands" alone must not match');
    // No search term (e.g. hashtag or direct discovery) means no gate.
    assert.equal(matchesNiche(pizzaPage, null), true);
    assert.equal(matchesNiche(pizzaPage, 'the'), true, 'stopword-only terms disable the gate');
});

test('engine-scoped extraction ignores junk links outside organic results', () => {
    const html = `
        <html><body>
            <li class="b_algo"><h2><a href="https://realstore.com/collections/all">Real Store</a></h2></li>
            <div class="b_sidebar"><a href="https://junk-calculator.de/">Junk</a></div>
            <footer><a href="https://random-adsite.xxx/">Ad</a></footer>
        </body></html>`;
    const $ = cheerio.load(html);
    const domains = extractStoreCandidates($, html, 'bing').map((c) => c.domain);
    assert.deepEqual(domains, ['realstore.com']);
    // Unknown engine markup falls back to all anchors (still domain-filtered).
    const fallback = extractStoreCandidates($, html, 'duckduckgo').map((c) => c.domain);
    assert.ok(fallback.includes('realstore.com'));
});
