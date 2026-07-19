import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { extractContacts } from '../src/contact-extraction/extract.js';
import {
    extractEmails, extractPhonesFromTelHrefs, extractPhonesFromText, extractUrlFromText,
} from '../src/utils/text.js';

const shopifyHtml = readFileSync(new URL('./fixtures/shopify-store.html', import.meta.url), 'utf8');
const plainHtml = readFileSync(new URL('./fixtures/plain-website.html', import.meta.url), 'utf8');

test('extracts email, phone, contact page, and metadata from a store page', () => {
    const $ = cheerio.load(shopifyHtml);
    const contact = extractContacts($, shopifyHtml, 'https://examplebrand.com/');

    assert.deepEqual(contact.emails, ['hello@examplebrand.com']);
    assert.ok(contact.phones[0].replace(/\D/g, '').startsWith('44207'));
    assert.equal(contact.contactPageUrl, 'https://examplebrand.com/pages/contact');
    assert.equal(contact.businessName, 'Example Brand');
    assert.match(contact.pageTitle, /Example Brand/);
    assert.match(contact.metaDescription, /skincare/i);
    assert.ok(contact.socialLinks.some((l) => l.includes('instagram.com')));
    assert.ok(contact.locationHints.some((h) => /United Kingdom/.test(h)));
});

test('filters junk email-like strings (assets, sentry, placeholders)', () => {
    assert.deepEqual(extractEmails('logo@2x.png hi@example.com real@brandmail.co abc@sentry.io'), ['real@brandmail.co']);
    const $ = cheerio.load(plainHtml);
    const contact = extractContacts($, plainHtml, 'https://studioverde.co.uk/');
    assert.deepEqual(contact.emails, ['studio@studioverde.co.uk']);
});

test('finds contact page from link text even with non-standard path', () => {
    const $ = cheerio.load(plainHtml);
    const contact = extractContacts($, plainHtml, 'https://studioverde.co.uk/');
    assert.equal(contact.contactPageUrl, 'https://studioverde.co.uk/get-in-touch');
});

test('extractUrlFromText finds bio websites, skips emails and socials', () => {
    assert.equal(extractUrlFromText('Independent skincare 🌿 shop at examplebrand.com'), 'https://examplebrand.com');
    assert.equal(extractUrlFromText('Links: linktr.ee/examplebrand 👇'), 'https://linktr.ee/examplebrand');
    assert.equal(extractUrlFromText('Visit https://www.brand.co.uk/shop today'), 'https://www.brand.co.uk/shop');
    // Email domains are not websites; instagram links are skipped.
    assert.equal(extractUrlFromText('DM or email hello@examplebrand.com'), null);
    assert.equal(extractUrlFromText('Also at instagram.com/other'), null);
    assert.equal(extractUrlFromText('Est. 2020. No links here!'), null);
    assert.equal(extractUrlFromText(null), null);
});

test('phone extraction: tel hrefs trusted, free text conservative', () => {
    assert.deepEqual(extractPhonesFromTelHrefs(['tel:+44 20 7123 4567']), ['+44 20 7123 4567']);
    assert.deepEqual(extractPhonesFromTelHrefs(['tel:123']), [], 'too short');
    assert.deepEqual(extractPhonesFromText('Order #123456789012345678 costs $1,299.00'), [], 'no false positives');
    assert.equal(extractPhonesFromText('Call us at +63 917 123 4567 today').length, 1);
});
