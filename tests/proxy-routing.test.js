import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, PREMIUM_PROXY_LABELS, PRODUCTS_JSON_LIMIT } from '../src/constants.js';

test('Instagram and SERP labels use the premium (residential) proxy pool', () => {
    const premium = [
        LABELS.PROFILE, LABELS.PROFILE_HTML, LABELS.HASHTAG, LABELS.TOPSEARCH,
        LABELS.SEARCH, LABELS.STORE_SEARCH,
    ];
    for (const label of premium) {
        assert.ok(PREMIUM_PROXY_LABELS.has(label), `${label} must use the premium proxy pool`);
    }
});

test('store-facing labels stay on cheap datacenter proxy', () => {
    const datacenter = [
        LABELS.STORE_CHECK, LABELS.WEBSITE, LABELS.PRODUCTS_JSON,
        LABELS.CONTACT_PAGE, LABELS.GOOGLE_SEARCH,
    ];
    for (const label of datacenter) {
        assert.ok(!PREMIUM_PROXY_LABELS.has(label), `${label} must not burn residential data transfer`);
    }
});

test('products.json probe page size stays small (data transfer is billed per GB)', () => {
    assert.ok(PRODUCTS_JSON_LIMIT >= 10 && PRODUCTS_JSON_LIMIT <= 50);
});
