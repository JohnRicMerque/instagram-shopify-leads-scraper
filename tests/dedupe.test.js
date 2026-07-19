import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateLeads } from '../src/deduplication/dedupe.js';

function row(overrides = {}) {
    return {
        username: 'user',
        instagramUrl: `https://www.instagram.com/${overrides.username ?? 'user'}/`,
        fullName: null,
        websiteDomain: null,
        publicEmail: null,
        leadScore: 50,
        followersCount: 1000,
        ...overrides,
    };
}

test('merges accounts sharing the same website domain, keeping the strongest', () => {
    const rows = [
        row({ username: 'main', websiteDomain: 'brand.com', leadScore: 90 }),
        row({ username: 'backup', websiteDomain: 'brand.com', leadScore: 60 }),
        row({ username: 'other', websiteDomain: 'other.com', leadScore: 70 }),
    ];
    const { rows: kept, duplicatesRemoved } = deduplicateLeads(rows);
    assert.equal(kept.length, 2);
    assert.equal(duplicatesRemoved, 1);
    const primary = kept.find((r) => r.username === 'main');
    assert.deepEqual(primary.relatedInstagramAccounts, ['https://www.instagram.com/backup/']);
});

test('merges accounts sharing the same public email', () => {
    const rows = [
        row({ username: 'a', publicEmail: 'hello@brand.com', leadScore: 80 }),
        row({ username: 'b', publicEmail: 'HELLO@brand.com', leadScore: 40 }),
    ];
    const { rows: kept, duplicatesRemoved } = deduplicateLeads(rows);
    assert.equal(kept.length, 1);
    assert.equal(duplicatesRemoved, 1);
    assert.equal(kept[0].username, 'a');
});

test('business name merges only when neither row has domain or email', () => {
    const nameOnly = deduplicateLeads([
        row({ username: 'a', fullName: 'Example Brand' }),
        row({ username: 'b', fullName: 'example brand' }),
    ]);
    assert.equal(nameOnly.rows.length, 1);

    // Same name but distinct domains -> different businesses, no merge.
    const distinct = deduplicateLeads([
        row({ username: 'a', fullName: 'Example Brand', websiteDomain: 'one.com' }),
        row({ username: 'b', fullName: 'Example Brand', websiteDomain: 'two.com' }),
    ]);
    assert.equal(distinct.rows.length, 2);
});

test('does not merge unrelated rows', () => {
    const { rows: kept, duplicatesRemoved } = deduplicateLeads([
        row({ username: 'a', websiteDomain: 'one.com' }),
        row({ username: 'b', websiteDomain: 'two.com' }),
        row({ username: 'c' }),
    ]);
    assert.equal(kept.length, 3);
    assert.equal(duplicatesRemoved, 0);
});
