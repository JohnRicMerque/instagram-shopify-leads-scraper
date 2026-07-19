import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeUsername, usernameFromInstagramUrl, unwrapRedirectUrl,
    parseCompactNumber, normalizeDomain, canonicalUrl, stripTrackingParams,
} from '../src/utils/normalize.js';

test('normalizeUsername handles handles, casing, and URLs', () => {
    assert.equal(normalizeUsername('@ExampleBrand'), 'examplebrand');
    assert.equal(normalizeUsername('  example.brand_1  '), 'example.brand_1');
    assert.equal(normalizeUsername('https://www.instagram.com/ExampleBrand/'), 'examplebrand');
    assert.equal(normalizeUsername('instagram.com/examplebrand?hl=en'), 'examplebrand');
    assert.equal(normalizeUsername(''), null);
    assert.equal(normalizeUsername('has spaces here'), 'has');
    assert.equal(normalizeUsername('not–valid✗'), null);
});

test('usernameFromInstagramUrl accepts profiles, rejects non-profile paths', () => {
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/examplebrand/'), 'examplebrand');
    assert.equal(usernameFromInstagramUrl('https://instagram.com/examplebrand/reels/'), 'examplebrand');
    // Username is recoverable from per-user post URLs.
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/examplebrand/p/Cxyz123/'), 'examplebrand');
    // Reserved/system paths are never usernames.
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/p/Cxyz123/'), null);
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/reel/Cxyz123/'), null);
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/explore/tags/skincare/'), null);
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/accounts/login/'), null);
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/stories/examplebrand/123/'), null);
    assert.equal(usernameFromInstagramUrl('https://example.com/examplebrand/'), null);
    assert.equal(usernameFromInstagramUrl('https://www.instagram.com/'), null);
});

test('unwrapRedirectUrl unwraps Instagram shim and DuckDuckGo redirects', () => {
    assert.equal(
        unwrapRedirectUrl('https://l.instagram.com/?u=https%3A%2F%2Fexamplebrand.com%2F&e=xyz'),
        'https://examplebrand.com/',
    );
    assert.equal(
        unwrapRedirectUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Fexamplebrand%2F&rut=abc'),
        'https://www.instagram.com/examplebrand/',
    );
    assert.equal(unwrapRedirectUrl('https://examplebrand.com/shop'), 'https://examplebrand.com/shop');
    assert.equal(unwrapRedirectUrl('not a url at all ::'), null);
});

test('unwrapRedirectUrl decodes Bing /ck/a base64-wrapped result links', () => {
    const target = 'https://www.instagram.com/examplebrand/';
    const wrapped = `https://www.bing.com/ck/a?!&&p=abc123&u=a1${Buffer.from(target).toString('base64url')}&ntb=1`;
    assert.equal(unwrapRedirectUrl(wrapped), target);
    // Malformed u param falls back to the original URL without throwing.
    assert.match(unwrapRedirectUrl('https://www.bing.com/ck/a?u=a1%%%'), /bing\.com\/ck\/a/);
});

test('parseCompactNumber parses K/M suffixes and separators', () => {
    assert.equal(parseCompactNumber('18.4K'), 18400);
    assert.equal(parseCompactNumber('2M'), 2000000);
    assert.equal(parseCompactNumber('1,234'), 1234);
    assert.equal(parseCompactNumber(386), 386);
    assert.equal(parseCompactNumber('n/a'), null);
});

test('stripTrackingParams removes utm/fbclid but keeps real params', () => {
    assert.equal(
        stripTrackingParams('https://brand.com/collections/new?utm_source=instagram&utm_medium=social&fbclid=xyz'),
        'https://brand.com/collections/new',
    );
    assert.equal(
        stripTrackingParams('https://brand.com/products?variant=123&utm_campaign=bio'),
        'https://brand.com/products?variant=123',
    );
});

test('normalizeDomain and canonicalUrl', () => {
    assert.equal(normalizeDomain('https://WWW.ExampleBrand.com/shop?x=1'), 'examplebrand.com');
    assert.equal(normalizeDomain('examplebrand.com'), 'examplebrand.com');
    assert.equal(canonicalUrl('https://ExampleBrand.com/Shop/'), 'https://examplebrand.com/shop');
});
