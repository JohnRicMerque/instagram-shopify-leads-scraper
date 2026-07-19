import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEmailDomain } from '../src/utils/email-verify.js';
import {
    buildGoogleSearchRequests, nextGooglePageRequest, extractLinksFromCse, googleCseUrl,
} from '../src/discovery/google-cse.js';
import { storeCandidatesFromUrls } from '../src/discovery/store-search.js';
import { parseInput } from '../src/input.js';

// ---------------------------------------------------------- MX verification

test('verifyEmailDomain: MX records mean deliverable', async () => {
    const cache = new Map();
    const resolver = async () => [{ exchange: 'mx.brand.com', priority: 10 }];
    assert.equal(await verifyEmailDomain('hi@brand.com', { resolver, cache }), true);
});

test('verifyEmailDomain: missing domain is false, transient errors unknown', async () => {
    const cache = new Map();
    const notFound = async () => { const e = new Error('nf'); e.code = 'ENOTFOUND'; throw e; };
    assert.equal(await verifyEmailDomain('hi@dead-domain.com', { resolver: notFound, cache }), false);

    const flaky = async () => { throw new Error('EAI_AGAIN'); };
    assert.equal(await verifyEmailDomain('hi@flaky.com', { resolver: flaky, cache }), null);
    assert.equal(await verifyEmailDomain('not-an-email', { cache }), null);
});

test('verifyEmailDomain caches per domain', async () => {
    const cache = new Map();
    let calls = 0;
    const resolver = async () => { calls += 1; return [{ exchange: 'mx' }]; };
    await verifyEmailDomain('a@same.com', { resolver, cache });
    await verifyEmailDomain('b@same.com', { resolver, cache });
    assert.equal(calls, 1);
});

// ---------------------------------------------------------- Google CSE

test('Google CSE requests are built only when key and cx are provided', () => {
    const noKey = parseInput({ searchTerms: ['skincare'] });
    assert.deepEqual(buildGoogleSearchRequests(noKey), []);

    const withKey = parseInput({ searchTerms: ['skincare'], googleApiKey: 'KEY', googleCseId: 'CX' });
    const requests = buildGoogleSearchRequests(withKey);
    assert.ok(requests.length > 0);
    const kinds = new Set(requests.map((r) => r.userData.kind));
    assert.ok(kinds.has('profiles') && kinds.has('stores'), 'both pipelines covered in "both" mode');
    assert.ok(requests[0].url.includes('key=KEY') && requests[0].url.includes('cx=CX'));
});

test('Google CSE pagination stops after three pages', () => {
    const input = parseInput({ searchTerms: ['x'], googleApiKey: 'KEY', googleCseId: 'CX' });
    const userData = { kind: 'stores', query: 'q', source: {}, start: 1 };
    const page2 = nextGooglePageRequest(input, userData);
    assert.equal(page2.userData.start, 11);
    assert.match(page2.url, /&start=11/);
    assert.equal(nextGooglePageRequest(input, { ...userData, start: 21 }), null);
});

test('extractLinksFromCse handles results, empty, and error payloads', () => {
    assert.deepEqual(
        extractLinksFromCse({ items: [{ link: 'https://a.com/x' }, { title: 'no link' }] }),
        ['https://a.com/x'],
    );
    assert.deepEqual(extractLinksFromCse({}), []);
    assert.deepEqual(extractLinksFromCse(null), []);
});

test('googleCseUrl encodes the query', () => {
    assert.match(googleCseUrl('k', 'c', '"powered by shopify" tea'), /q=%22powered%20by%20shopify%22%20tea/);
});

// ------------------------------------------------- store candidates from URLs

test('storeCandidatesFromUrls filters and normalizes like SERP extraction', () => {
    const candidates = storeCandidatesFromUrls([
        'https://brand.com/products/serum',
        'https://en.wikipedia.org/wiki/Shopify',
        'https://cool.myshopify.com/collections/all',
        'not a url',
    ]);
    assert.deepEqual(candidates.map((c) => c.domain).sort(), ['brand.com', 'cool.myshopify.com']);
    assert.equal(candidates.find((c) => c.domain === 'brand.com').url, 'https://brand.com/');
});
