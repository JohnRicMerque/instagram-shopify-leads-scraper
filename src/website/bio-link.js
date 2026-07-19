/**
 * Link-in-bio resolution: recognizes Linktree/Beacons/Stan/Taplink/etc.
 * pages and extracts outbound *business* links, ignoring social, payment,
 * and messaging links. Prioritizes links labeled shop/store/website/….
 */
import {
    LINK_IN_BIO_HOSTS,
    IGNORED_OUTBOUND_DOMAINS,
    PRIORITY_LINK_REGEX,
} from '../constants.js';
import { toUrl, normalizeDomain, unwrapRedirectUrl, domainMatches } from '../utils/normalize.js';

/** Returns the service name when the hostname is a known link-in-bio host. */
export function linkInBioService(rawUrl) {
    const domain = normalizeDomain(rawUrl);
    if (!domain) return null;
    for (const [host, service] of Object.entries(LINK_IN_BIO_HOSTS)) {
        if (domain === host || domain.endsWith(`.${host}`)) return service;
    }
    return null;
}

function isIgnoredDomain(hostname) {
    const clean = hostname.toLowerCase().replace(/^www\./, '');
    for (const ignored of IGNORED_OUTBOUND_DOMAINS) {
        if (clean === ignored || clean.endsWith(`.${ignored}`)) return true;
    }
    // Never hop from one link-in-bio page to another (loop prevention).
    for (const libHost of Object.keys(LINK_IN_BIO_HOSTS)) {
        if (clean === libHost || clean.endsWith(`.${libHost}`)) return true;
    }
    return false;
}

/** Pull links out of Linktree's embedded __NEXT_DATA__ JSON when present. */
function linksFromNextData($) {
    const raw = $('script#__NEXT_DATA__').html();
    if (!raw) return [];
    try {
        const data = JSON.parse(raw);
        const links = data?.props?.pageProps?.links ?? data?.props?.pageProps?.account?.links ?? [];
        return links
            .map((l) => ({ url: l?.url, label: l?.title ?? '' }))
            .filter((l) => typeof l.url === 'string');
    } catch {
        return [];
    }
}

/**
 * Extract outbound business-link candidates from a link-in-bio page,
 * ordered by relevance (shop/store/website labels first), unique by domain.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} baseUrl the loaded page URL
 * @param {number} maxCandidates
 * @returns {{url: string, label: string, priority: number}[]}
 */
export function extractOutboundLinks($, baseUrl, maxCandidates = 3) {
    const base = toUrl(baseUrl);
    const found = [];

    const push = (rawHref, label) => {
        if (!rawHref) return;
        let href = rawHref.trim();
        if (href.startsWith('//')) href = `https:${href}`;
        if (/^(mailto:|tel:|sms:|javascript:|#)/i.test(href)) return;
        const unwrapped = unwrapRedirectUrl(href);
        const url = toUrl(unwrapped);
        if (!url) return;
        if (!/^https?:$/.test(url.protocol)) return;
        // Files (PDF terms, images, videos) are never business websites.
        if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|mp[34]|mov|avi|docx?|xlsx?|pptx?)$/i.test(url.pathname)) return;
        if (base && domainMatches(url.hostname, normalizeDomain(base.href))) return; // internal link
        if (isIgnoredDomain(url.hostname)) return;
        found.push({
            url: url.href,
            label: (label ?? '').trim(),
            priority: PRIORITY_LINK_REGEX.test(`${label} ${url.pathname}`) ? 2 : 1,
        });
    };

    for (const link of linksFromNextData($)) push(link.url, link.label);

    $('a[href]').each((_, el) => {
        const $el = $(el);
        push($el.attr('href'), $el.attr('aria-label') || $el.text());
    });

    // Sort by priority, then keep the first link seen per domain.
    found.sort((a, b) => b.priority - a.priority);
    const byDomain = new Map();
    for (const link of found) {
        const domain = normalizeDomain(link.url);
        if (!domain || byDomain.has(domain)) continue;
        byDomain.set(domain, link);
        if (byDomain.size >= maxCandidates) break;
    }
    return [...byDomain.values()];
}
