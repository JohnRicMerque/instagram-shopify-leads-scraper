import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { linkInBioService, extractOutboundLinks } from '../src/website/bio-link.js';

const linktreeHtml = readFileSync(new URL('./fixtures/linktree.html', import.meta.url), 'utf8');

test('recognizes link-in-bio services by hostname', () => {
    assert.equal(linkInBioService('https://linktr.ee/examplebrand'), 'Linktree');
    assert.equal(linkInBioService('https://beacons.ai/examplebrand'), 'Beacons');
    assert.equal(linkInBioService('https://stan.store/examplebrand'), 'Stan');
    assert.equal(linkInBioService('https://taplink.cc/examplebrand'), 'Taplink');
    assert.equal(linkInBioService('https://examplebrand.com'), null);
    assert.equal(linkInBioService('https://www.instagram.com/examplebrand/'), null);
});

test('extracts business links, ignoring social/payment/messaging links', () => {
    const $ = cheerio.load(linktreeHtml);
    const links = extractOutboundLinks($, 'https://linktr.ee/examplebrand', 3);

    const domains = links.map((l) => new URL(l.url).hostname.replace(/^www\./, ''));
    assert.ok(domains.includes('examplebrand.com'), 'store link must be kept');
    assert.ok(!domains.some((d) => d.includes('instagram')), 'instagram excluded');
    assert.ok(!domains.some((d) => d.includes('spotify')), 'spotify excluded');
    assert.ok(!domains.some((d) => d.includes('paypal')), 'paypal excluded');
    assert.ok(!domains.some((d) => d.includes('wa.me')), 'whatsapp excluded');

    // The shop-labeled link must rank first.
    assert.equal(new URL(links[0].url).hostname.replace(/^www\./, ''), 'examplebrand.com');
    assert.equal(links[0].priority, 2);
});

test('respects the max-candidates limit and dedupes by domain', () => {
    const html = `
        <a href="https://one.com/shop">Shop</a>
        <a href="https://one.com/other">One again</a>
        <a href="https://two.com">Two</a>
        <a href="https://three.com">Three</a>
        <a href="https://four.com">Four</a>`;
    const $ = cheerio.load(html);
    const links = extractOutboundLinks($, 'https://linktr.ee/x', 3);
    assert.equal(links.length, 3);
    const domains = new Set(links.map((l) => new URL(l.url).hostname));
    assert.equal(domains.size, 3, 'unique domains only');
});
