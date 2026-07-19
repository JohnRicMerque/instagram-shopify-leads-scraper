import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectPlatform, parseProductsJson, detectStoreIntelligence } from '../src/platform-detection/detect.js';

const shopifyHtml = readFileSync(new URL('./fixtures/shopify-store.html', import.meta.url), 'utf8');
const wooHtml = readFileSync(new URL('./fixtures/woocommerce.html', import.meta.url), 'utf8');
const plainHtml = readFileSync(new URL('./fixtures/plain-website.html', import.meta.url), 'utf8');

test('detects Shopify from multiple independent signals', () => {
    const result = detectPlatform(shopifyHtml, {}, 'https://examplebrand.com/');
    assert.equal(result.platform, 'Shopify');
    assert.equal(result.isShopify, true);
    assert.ok(result.shopifySignals.length >= 3, `expected >=3 signals, got ${result.shopifySignals.length}`);
    assert.ok(result.shopifyConfidence >= 0.5);
    assert.equal(result.hasOnlineStore, true);
});

test('never classifies Shopify from URL paths alone', () => {
    const pathOnlyHtml = `
        <html><body>
            <a href="/collections/all">Shop</a>
            <a href="/cart">Cart</a>
            <a href="/products/serum">Serum</a>
        </body></html>`;
    const result = detectPlatform(pathOnlyHtml, {}, 'https://somesite.com/');
    assert.equal(result.isShopify, false);
});

test('Shopify response headers count as a strong signal', () => {
    const html = '<html><body><img src="https://cdn.shopify.com/s/files/1/img.jpg"></body></html>';
    const headers = { 'x-shopify-stage': 'production', 'x-sorting-hat-shopid': '123' };
    const result = detectPlatform(html, headers, 'https://examplebrand.com/');
    assert.equal(result.isShopify, true);
    assert.ok(result.shopifySignals.some((s) => s.includes('headers')));
});

test('myshopify.com hosting domain confirms Shopify', () => {
    const result = detectPlatform('<html></html>', {}, 'https://example-brand.myshopify.com/');
    assert.equal(result.isShopify, true);
});

test('detects WooCommerce and does not call it Shopify', () => {
    const result = detectPlatform(wooHtml, {}, 'https://craftcandle.co/');
    assert.equal(result.platform, 'WooCommerce');
    assert.equal(result.isShopify, false);
    assert.equal(result.hasOnlineStore, true);
});

test('plain brochure website: Unknown platform, no store', () => {
    const result = detectPlatform(plainHtml, {}, 'https://studioverde.co.uk/');
    assert.equal(result.platform, 'Unknown');
    assert.equal(result.isShopify, false);
    assert.equal(result.hasOnlineStore, false);
});

test('detectStoreIntelligence finds installed apps and store currency', () => {
    const intel = detectStoreIntelligence(shopifyHtml);
    assert.ok(intel.detectedApps.includes('Klaviyo'));
    assert.ok(intel.detectedApps.includes('Judge.me'));
    assert.equal(intel.storeCurrency, 'GBP');

    const empty = detectStoreIntelligence(plainHtml);
    assert.deepEqual(empty.detectedApps, []);
    assert.equal(empty.storeCurrency, null);
    assert.deepEqual(detectStoreIntelligence(null).detectedApps, []);
});

test('parseProductsJson confirms only the exact Shopify payload shape', () => {
    assert.deepEqual(
        parseProductsJson({ products: [{ handle: 'serum', variants: [] }, { handle: 'balm', variants: [] }] }),
        { confirmed: true, productCount: 2 },
    );
    assert.equal(parseProductsJson({ products: [{ name: 'not-shopify' }] }).confirmed, false);
    assert.equal(parseProductsJson({ items: [] }).confirmed, false);
    assert.equal(parseProductsJson(null).confirmed, false);
    assert.equal(parseProductsJson({ products: [] }).confirmed, false, 'empty catalog is not confirmation');
});
