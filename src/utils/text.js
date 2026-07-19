/**
 * Text extraction helpers: emails, phones, hashtags.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// File extensions and junk domains that commonly appear in email-shaped strings.
const EMAIL_JUNK_RE = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|ico|mp4|pdf)$/i;
const EMAIL_JUNK_DOMAINS = [
    'example.com', 'example.org', 'domain.com', 'email.com', 'yourdomain.com',
    'sentry.io', 'wixpress.com', 'sentry-next.wixpress.com', 'mysite.com',
    'company.com', 'yourbusiness.com', 'placeholder.com', 'shopify.com',
];

/** Extract plausible, deduplicated, lowercased email addresses from text/HTML. */
export function extractEmails(text) {
    if (!text) return [];
    const found = text.match(EMAIL_RE) ?? [];
    const cleaned = new Set();
    for (const raw of found) {
        const email = raw.toLowerCase().replace(/^[.%+-]+/, '');
        if (EMAIL_JUNK_RE.test(email)) continue;
        const domain = email.split('@')[1] ?? '';
        if (EMAIL_JUNK_DOMAINS.some((junk) => domain === junk || domain.endsWith(`.${junk}`))) continue;
        if (/@\dx\./.test(email)) continue; // image@2x.png style artifacts
        if (email.length > 80) continue;
        cleaned.add(email);
    }
    return [...cleaned];
}

/**
 * Extract phone numbers. `tel:` hrefs are trusted; free-text matching is
 * intentionally conservative (international-looking numbers only) to avoid
 * matching prices, dates, and order numbers.
 */
export function extractPhonesFromTelHrefs(hrefs) {
    const phones = new Set();
    for (const href of hrefs ?? []) {
        if (!href || !href.toLowerCase().startsWith('tel:')) continue;
        const value = decodeURIComponent(href.slice(4)).replace(/[^\d+()\-.\s]/g, '').trim();
        const digits = value.replace(/\D/g, '');
        if (digits.length >= 7 && digits.length <= 15) phones.add(value);
    }
    return [...phones];
}

const PHONE_TEXT_RE = /(?:\+|00)\d[\d\s().-]{6,17}\d/g;

export function extractPhonesFromText(text) {
    if (!text) return [];
    const phones = new Set();
    for (const match of text.match(PHONE_TEXT_RE) ?? []) {
        const digits = match.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) phones.add(match.trim());
    }
    return [...phones];
}

const URL_IN_TEXT_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9][a-z0-9-]{0,62})*\.[a-z]{2,12}(?:\/[^\s"'<>()]*)?/gi;

// Plausible TLDs for bio-text website detection (keeps "e.g." and similar
// fragments from being treated as domains).
const COMMON_TLDS = new Set([
    'com', 'net', 'org', 'co', 'io', 'me', 'ee', 'shop', 'store', 'site', 'online',
    'biz', 'info', 'xyz', 'link', 'bio', 'club', 'life', 'world', 'beauty', 'skin',
    'hair', 'boutique', 'studio', 'design', 'art', 'app', 'page', 'uk', 'us', 'ca',
    'au', 'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'dk', 'fi', 'pl', 'pt', 'br',
    'mx', 'ar', 'cl', 'ph', 'id', 'in', 'sg', 'my', 'th', 'vn', 'jp', 'kr', 'hk',
    'tw', 'ae', 'sa', 'za', 'ng', 'ke', 'eg', 'tr', 'gr', 'cz', 'hu', 'ro', 'at',
    'ch', 'be', 'ie', 'nz',
]);

/**
 * Find the first website URL mentioned in free text (e.g. an Instagram bio).
 * Email addresses are ignored; instagram/facebook links are skipped.
 * Returns a normalized https:// URL or null.
 */
export function extractUrlFromText(text) {
    if (!text) return null;
    const withoutEmails = text.replace(EMAIL_RE, ' ');
    for (const raw of withoutEmails.match(URL_IN_TEXT_RE) ?? []) {
        const candidate = raw.replace(/[.,;:!?)\]]+$/, '');
        const lower = candidate.toLowerCase();
        if (/instagram\.com|facebook\.com|fb\.com/.test(lower)) continue;
        const host = lower.replace(/^https?:\/\//, '').split('/')[0];
        const tld = host.split('.').pop();
        if (!COMMON_TLDS.has(tld)) continue;
        return lower.startsWith('http') ? candidate : `https://${candidate}`;
    }
    return null;
}

/** Extract #hashtags from a caption or bio. */
export function extractHashtags(text) {
    if (!text) return [];
    const tags = new Set();
    for (const match of text.match(/#[\p{L}\p{N}_]{2,60}/gu) ?? []) {
        tags.add(match.toLowerCase());
    }
    return [...tags];
}

/** Shorten a caption to a snippet. */
export function snippet(text, maxLength = 120) {
    if (!text) return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}
