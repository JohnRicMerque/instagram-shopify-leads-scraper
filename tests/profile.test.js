import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { parseProfileApi, parseProfileHtml, usableExternalUrl, relatedUsernames } from '../src/instagram/profile.js';
import { analyzeActivity } from '../src/instagram/activity.js';

const missingFieldsResponse = JSON.parse(
    readFileSync(new URL('./fixtures/instagram-profile-missing.json', import.meta.url), 'utf8'),
);

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const DAY_S = 24 * 60 * 60;

function fullUser() {
    const nowSec = Math.floor(NOW / 1000);
    return {
        username: 'ExampleBrand',
        full_name: 'Example Brand',
        biography: 'Independent skincare brand',
        category_name: 'Health/beauty',
        is_business_account: true,
        is_professional_account: true,
        is_verified: false,
        edge_followed_by: { count: 18400 },
        edge_follow: { count: 420 },
        external_url: 'https://l.instagram.com/?u=https%3A%2F%2Flinktr.ee%2Fexamplebrand',
        business_email: 'hello@examplebrand.com',
        business_phone_number: null,
        profile_pic_url_hd: 'https://cdn.example/pic.jpg',
        edge_owner_to_timeline_media: {
            count: 386,
            edges: [
                { node: { taken_at_timestamp: nowSec - 2 * DAY_S, __typename: 'GraphImage', edge_liked_by: { count: 500 }, edge_media_to_comment: { count: 30 }, edge_media_to_caption: { edges: [{ node: { text: 'New drop! #skincare #glowup' } }] } } },
                { node: { taken_at_timestamp: nowSec - 10 * DAY_S, __typename: 'GraphVideo', is_video: true, edge_liked_by: { count: 520 }, edge_media_to_comment: { count: 26 }, edge_media_to_caption: { edges: [{ node: { text: 'Behind the scenes #skincare' } }] } } },
                { node: { taken_at_timestamp: nowSec - 45 * DAY_S, __typename: 'GraphSidecar', edge_liked_by: { count: -1 }, edge_media_to_comment: { count: 28 }, edge_media_to_caption: { edges: [] } } },
            ],
        },
    };
}

test('parseProfileApi extracts full profile and unwraps the bio link shim', () => {
    const profile = parseProfileApi(fullUser());
    assert.equal(profile.username, 'examplebrand');
    assert.equal(profile.instagramUrl, 'https://www.instagram.com/examplebrand/');
    assert.equal(profile.fullName, 'Example Brand');
    assert.equal(profile.followersCount, 18400);
    assert.equal(profile.externalUrl, 'https://linktr.ee/examplebrand');
    assert.equal(profile.publicEmail, 'hello@examplebrand.com');
    assert.equal(profile.isBusinessAccount, true);
});

test('parseProfileApi tolerates missing fields without throwing', () => {
    const profile = parseProfileApi(missingFieldsResponse.data.user);
    assert.equal(profile.username, 'minimalprofile');
    assert.equal(profile.fullName, null);
    assert.equal(profile.followersCount, null);
    assert.equal(profile.externalUrl, null);
    assert.equal(profile.publicEmail, null);
    assert.equal(parseProfileApi(null), null);
});

test('analyzeActivity computes engagement from visible posts only', () => {
    const activity = analyzeActivity(fullUser(), 6, NOW);
    assert.equal(activity.analyzedPostsCount, 3);
    assert.equal(activity.latestPostDate, new Date(NOW - 2 * DAY_S * 1000).toISOString());
    assert.equal(activity.postsLast30Days, 2);
    // Hidden like count (-1) is excluded: (500 + 520) / 2 = 510
    assert.equal(activity.averageLikes, 510);
    assert.equal(activity.averageComments, 28);
    // (510 + 28) / 18400 * 100 = 2.92
    assert.equal(activity.averageEngagementRate, 2.92);
    assert.equal(activity.isActive, true);
    assert.deepEqual(activity.contentTypes.sort(), ['carousel', 'image', 'video']);
    assert.ok(activity.recentHashtags.includes('#skincare'));
});

test('analyzeActivity returns nulls when data is unavailable', () => {
    const activity = analyzeActivity(missingFieldsResponse.data.user, 6, NOW);
    assert.equal(activity.latestPostDate, null);
    assert.equal(activity.averageLikes, null);
    assert.equal(activity.averageEngagementRate, null);
    assert.equal(activity.isActive, null);
    assert.equal(analyzeActivity(null, 6, NOW).averageLikes, null);
});

test('parseProfileHtml falls back to OpenGraph metadata', () => {
    const html = `
        <html><head>
            <meta property="og:title" content="Example Brand (@examplebrand) • Instagram photos and videos">
            <meta property="og:description" content="18.4K Followers, 420 Following, 386 Posts - Example Brand (@examplebrand) on Instagram: &quot;Independent skincare brand&quot;">
            <meta property="og:image" content="https://cdn.example/pic.jpg">
        </head><body></body></html>`;
    const profile = parseProfileHtml(cheerio.load(html), 'examplebrand');
    assert.equal(profile.followersCount, 18400);
    assert.equal(profile.followingCount, 420);
    assert.equal(profile.postsCount, 386);
    assert.equal(profile.fullName, 'Example Brand');
    assert.equal(profile.biography, 'Independent skincare brand');
    assert.equal(profile.dataSource, 'html-fallback');

    assert.equal(parseProfileHtml(cheerio.load('<html><head></head></html>'), 'x'), null);
});

test('parseProfileHtml recovers website URL and email from the bio text', () => {
    const html = `
        <html><head>
            <meta property="og:description" content="12K Followers, 100 Following, 50 Posts - Bio Brand (@biobrand) on Instagram: &quot;Clean beauty 🌿 shop at linktr.ee/biobrand ✉️ hello@biobrand.com&quot;">
        </head><body></body></html>`;
    const profile = parseProfileHtml(cheerio.load(html), 'biobrand');
    assert.equal(profile.externalUrl, 'https://linktr.ee/biobrand');
    assert.equal(profile.publicEmail, 'hello@biobrand.com');
});

test('relatedUsernames extracts Instagram-suggested similar profiles', () => {
    const user = {
        edge_related_profiles: {
            edges: [
                { node: { username: 'SimilarBrand' } },
                { node: { username: 'another.brand' } },
                { node: {} },
            ],
        },
    };
    assert.deepEqual(relatedUsernames(user), ['similarbrand', 'another.brand']);
    assert.deepEqual(relatedUsernames({}), []);
    assert.deepEqual(relatedUsernames(null), []);
});

test('usableExternalUrl rejects instagram/facebook self-links', () => {
    assert.equal(usableExternalUrl('https://examplebrand.com'), 'https://examplebrand.com/');
    assert.equal(usableExternalUrl('https://www.instagram.com/other/'), null);
    assert.equal(usableExternalUrl(null), null);
});
