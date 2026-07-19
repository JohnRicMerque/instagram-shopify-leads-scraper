import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
    extractUsernamesFromSearchPage, buildSearchQueries, buildQueryVariants, nextSearchPageRequest,
} from '../src/discovery/search-engine.js';
import { SEARCH_ENGINE_BUILDERS, MAX_SEARCH_PAGES } from '../src/constants.js';
import { extractUsernamesFromTopsearch, isTopsearchBlocked } from '../src/discovery/topsearch.js';

test('buildQueryVariants adds commerce modifiers without duplicating words', () => {
    assert.deepEqual(buildQueryVariants('jewelry'), ['jewelry', 'jewelry shop', 'jewelry brand']);
    // "brands" already present -> no "brand" variant; "shop" still added.
    assert.deepEqual(buildQueryVariants('skincare brands'), ['skincare brands', 'skincare brands shop']);
    assert.deepEqual(buildQueryVariants('sneaker store'), ['sneaker store', 'sneaker store brand']);
});

test('buildSearchQueries combines terms, variants, and locations', () => {
    const queries = buildSearchQueries(['skincare brands'], ['United Kingdom', 'London']);
    assert.deepEqual(queries, [
        'site:instagram.com skincare brands United Kingdom',
        'site:instagram.com skincare brands London',
        'site:instagram.com skincare brands shop United Kingdom',
        'site:instagram.com skincare brands shop London',
    ]);
    assert.deepEqual(buildSearchQueries(['jewelry'], []), [
        'site:instagram.com jewelry',
        'site:instagram.com jewelry shop',
        'site:instagram.com jewelry brand',
    ]);
});

test('search pagination builds next-page requests up to the page limit', () => {
    assert.match(SEARCH_ENGINE_BUILDERS.bing('q', 2), /&first=31/);
    assert.match(SEARCH_ENGINE_BUILDERS.duckduckgo('q', 3), /&s=60/);
    assert.match(SEARCH_ENGINE_BUILDERS['duckduckgo-lite']('q', 2), /lite\.duckduckgo\.com.*&s=30/);
    assert.match(SEARCH_ENGINE_BUILDERS.mojeek('q', 2), /mojeek\.com.*&s=11/);
    assert.doesNotMatch(SEARCH_ENGINE_BUILDERS.bing('q', 1), /&first=/);

    const userData = { engine: 'bing', query: 'site:instagram.com skincare', source: {}, page: 1 };
    const next = nextSearchPageRequest(userData);
    assert.equal(next.userData.page, 2);
    assert.match(next.url, /first=31/);
    assert.equal(next.uniqueKey, 'bing:site:instagram.com skincare:p2');

    assert.equal(nextSearchPageRequest({ ...userData, page: MAX_SEARCH_PAGES }), null);
});

test('extracts usernames from Bing /ck/a wrapped result links', () => {
    const wrapped = `https://www.bing.com/ck/a?!&&p=x&u=a1${Buffer.from('https://www.instagram.com/wrappedbrand/').toString('base64url')}&ntb=1`;
    const html = `<html><body><li class="b_algo"><h2><a href="${wrapped}">Wrapped Brand</a></h2></li></body></html>`;
    const $ = cheerio.load(html);
    assert.deepEqual(extractUsernamesFromSearchPage($, html), ['wrappedbrand']);
});

test('topsearch: extracts account usernames, detects login walls', () => {
    const response = {
        users: [
            { user: { username: 'BrandOne', full_name: 'Brand One' } },
            { user: { username: 'brandtwo' } },
            { position: 3 },
        ],
        hashtags: [],
        status: 'ok',
    };
    assert.deepEqual(extractUsernamesFromTopsearch(response), ['brandone', 'brandtwo']);
    assert.equal(isTopsearchBlocked(response), false);
    assert.equal(isTopsearchBlocked({ require_login: true }), true);
    assert.equal(isTopsearchBlocked({ status: 'fail' }), true);
    assert.equal(isTopsearchBlocked(null), true);
    assert.equal(isTopsearchBlocked({ message: 'login_required' }), true, 'missing users array = blocked');
});

test('extracts profile usernames and filters post/login/explore URLs', () => {
    const html = `
        <html><body>
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Fbrandone%2F">Brand One</a>
            <a class="result__a" href="https://www.instagram.com/brandtwo/?hl=en">Brand Two</a>
            <a href="https://www.instagram.com/p/Cabc123/">A post</a>
            <a href="https://www.instagram.com/reel/Cdef456/">A reel</a>
            <a href="https://www.instagram.com/accounts/login/?next=%2Fbrandthree%2F">Login</a>
            <a href="https://www.instagram.com/explore/tags/skincare/">Explore</a>
            <cite>https://www.instagram.com/brandthree</cite>
            <a href="https://www.bing.com/somewhere">unrelated</a>
        </body></html>`;
    const $ = cheerio.load(html);
    const usernames = extractUsernamesFromSearchPage($, html);
    assert.deepEqual(usernames.sort(), ['brandone', 'brandthree', 'brandtwo']);
});
