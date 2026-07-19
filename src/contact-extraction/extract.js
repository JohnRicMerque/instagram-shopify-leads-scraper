/**
 * Contact and business-metadata extraction from a website page.
 * Deliberately shallow: homepage + (optionally) one contact page.
 * Only extracts information the business publishes for contact purposes.
 */
import { toUrl, normalizeDomain, domainMatches } from '../utils/normalize.js';
import { extractEmails, extractPhonesFromTelHrefs, extractPhonesFromText } from '../utils/text.js';

const CONTACT_PATH_RE = /contact|kontakt|get[-_\s]?in[-_\s]?touch|reach[-_\s]?us|support/i;
const ABOUT_PATH_RE = /about|our[-_\s]?story|who[-_\s]?we[-_\s]?are/i;

const SOCIAL_HOSTS = [
    'instagram.com', 'facebook.com', 'tiktok.com', 'twitter.com', 'x.com',
    'youtube.com', 'pinterest.com', 'linkedin.com', 'threads.net',
];

/**
 * Extract contacts and page metadata from a loaded page.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} html raw body
 * @param {string} pageUrl final URL of the page
 * @param {{ deepText?: boolean }} [options] deepText enables free-text phone
 *        matching (used on contact pages only, to limit false positives)
 */
export function extractContacts($, html, pageUrl, options = {}) {
    const base = toUrl(pageUrl);
    const baseDomain = base ? normalizeDomain(base.href) : null;

    const hrefs = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) hrefs.push({ href, text: $(el).text().trim() });
    });

    // Emails: mailto links are the strongest source, then visible text.
    const mailtoEmails = hrefs
        .filter(({ href }) => href.toLowerCase().startsWith('mailto:'))
        .flatMap(({ href }) => extractEmails(decodeURIComponent(href.slice(7).split('?')[0])));
    const textEmails = extractEmails($('body').text())
        .concat(extractEmails(html?.slice(0, 300_000) ?? ''));
    const emails = [...new Set([...mailtoEmails, ...textEmails])].slice(0, 5);

    // Phones: tel: links always; free text only when deepText requested.
    const phones = [...new Set([
        ...extractPhonesFromTelHrefs(hrefs.map(({ href }) => href)),
        ...(options.deepText ? extractPhonesFromText($('body').text()) : []),
    ])].slice(0, 3);

    // Contact / about page URLs on the same domain.
    let contactPageUrl = null;
    let aboutPageUrl = null;
    for (const { href, text } of hrefs) {
        const abs = toUrl(base ? new URL(href, base).href : href);
        if (!abs || !baseDomain || !domainMatches(abs.hostname, baseDomain)) continue;
        const hay = `${abs.pathname} ${text}`;
        if (!contactPageUrl && CONTACT_PATH_RE.test(hay)) contactPageUrl = abs.href;
        if (!aboutPageUrl && ABOUT_PATH_RE.test(hay)) aboutPageUrl = abs.href;
    }

    // Social links (unique per network).
    const socialLinks = [];
    const seenSocial = new Set();
    for (const { href } of hrefs) {
        const abs = toUrl(href);
        if (!abs) continue;
        const host = abs.hostname.toLowerCase().replace(/^www\./, '');
        const network = SOCIAL_HOSTS.find((s) => host === s || host.endsWith(`.${s}`));
        if (network && !seenSocial.has(network)) {
            seenSocial.add(network);
            socialLinks.push(abs.href);
        }
    }

    // Location hints from JSON-LD and address tags.
    const countryHints = new Set();
    for (const match of (html ?? '').matchAll(/"addressCountry"\s*:\s*"([^"]{2,40})"/g)) {
        countryHints.add(match[1]);
    }
    const addressText = $('address').first().text().replace(/\s+/g, ' ').trim();
    if (addressText && addressText.length <= 200) countryHints.add(addressText);

    return {
        emails,
        phones,
        contactPageUrl,
        aboutPageUrl,
        socialLinks,
        businessName: $('meta[property="og:site_name"]').attr('content')?.trim()
            || $('meta[name="application-name"]').attr('content')?.trim()
            || null,
        pageTitle: $('title').first().text().replace(/\s+/g, ' ').trim() || null,
        metaDescription: $('meta[name="description"]').attr('content')?.trim()
            || $('meta[property="og:description"]').attr('content')?.trim()
            || null,
        locationHints: [...countryHints].slice(0, 5),
    };
}
