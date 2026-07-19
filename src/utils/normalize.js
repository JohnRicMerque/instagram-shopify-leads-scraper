/**
 * URL / username / domain normalization helpers.
 * Pure functions — no network, no Apify dependencies — so they are easy to test.
 */
import { RESERVED_IG_PATHS } from '../constants.js';

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

/** Ensure a URL string has a protocol. Returns null when unparseable. */
export function toUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }
}

/** Lowercased hostname without the leading "www.". Null when unparseable. */
export function normalizeDomain(rawUrl) {
    const url = toUrl(rawUrl);
    if (!url) return null;
    return url.hostname.toLowerCase().replace(/^www\./, '') || null;
}

/** True when the hostname is `domain` or a subdomain of it. */
export function domainMatches(hostname, domain) {
    if (!hostname || !domain) return false;
    const h = hostname.toLowerCase().replace(/^www\./, '');
    return h === domain || h.endsWith(`.${domain}`);
}

/**
 * Extract an Instagram username from any instagram.com URL.
 * Works for profile URLs, sub-tabs (/reels/, /tagged/), and the newer
 * per-user post URLs (/username/p/CODE/). Returns null for non-profile
 * paths such as /explore/ or /p/CODE/.
 */
export function usernameFromInstagramUrl(rawUrl) {
    const url = toUrl(rawUrl);
    if (!url) return null;
    if (!domainMatches(url.hostname, 'instagram.com')) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    const first = decodeURIComponent(segments[0]).toLowerCase().replace(/^@+/, '');
    if (RESERVED_IG_PATHS.has(first)) return null;
    if (!USERNAME_RE.test(first)) return null;
    return first;
}

/**
 * Normalize any user-provided username / @handle / profile URL to a plain
 * lowercase username. Returns null when it cannot be a valid username.
 */
export function normalizeUsername(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let value = raw.trim().toLowerCase();
    if (!value) return null;
    if (value.includes('instagram.com')) return usernameFromInstagramUrl(value);
    value = value.replace(/^@+/, '').replace(/\/+$/, '').split(/[/?#\s]/)[0];
    if (!USERNAME_RE.test(value)) return null;
    if (RESERVED_IG_PATHS.has(value)) return null;
    return value;
}

/**
 * Unwrap Instagram's outbound-link shim (l.instagram.com/?u=...) and other
 * simple ?u=/?url= redirect wrappers. Returns the inner URL, or the
 * original when there is nothing to unwrap.
 */
export function unwrapRedirectUrl(rawUrl) {
    const url = toUrl(rawUrl);
    if (!url) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'l.instagram.com' || host === 'l.facebook.com' || host === 'lm.facebook.com') {
        const inner = url.searchParams.get('u');
        if (inner) {
            const unwrapped = toUrl(decodeURIComponent(inner));
            if (unwrapped) return unwrapped.href;
        }
    }
    // DuckDuckGo result redirects
    if (host.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')) {
        const inner = url.searchParams.get('uddg');
        if (inner) {
            const unwrapped = toUrl(decodeURIComponent(inner));
            if (unwrapped) return unwrapped.href;
        }
    }
    // Bing wraps every result as /ck/a?...&u=a1<base64url-of-target>, so the
    // target URL never appears literally in the href.
    if (host.endsWith('bing.com') && url.pathname.startsWith('/ck/')) {
        const inner = url.searchParams.get('u');
        if (inner && inner.startsWith('a1')) {
            try {
                const decoded = Buffer.from(inner.slice(2), 'base64url').toString('utf8');
                const unwrapped = toUrl(decoded);
                if (unwrapped) return unwrapped.href;
            } catch { /* not base64 — fall through */ }
        }
    }
    return url.href;
}

/** Parse compact follower counts like "18.4K", "1,234", "2M". */
export function parseCompactNumber(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const text = String(raw).trim().replace(/,/g, '');
    const match = text.match(/^([\d.]+)\s*([kmb])?$/i);
    if (!match) return null;
    const base = parseFloat(match[1]);
    if (!Number.isFinite(base)) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] ?? 1;
    return Math.round(base * mult);
}

const TRACKING_PARAM_RE = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|igsh|igshid|ref$|ref_|_ga)/i;

/** Remove marketing/tracking query parameters (utm_*, fbclid, …). */
export function stripTrackingParams(rawUrl) {
    const url = toUrl(rawUrl);
    if (!url) return null;
    for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAM_RE.test(key)) url.searchParams.delete(key);
    }
    let href = url.href;
    if (url.search === '' || url.search === '?') href = href.replace(/\?$/, '');
    return href;
}

/** Canonical form of a URL for dedup keys: origin + path, no trailing slash. */
export function canonicalUrl(rawUrl) {
    const url = toUrl(rawUrl);
    if (!url) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}`.toLowerCase();
}
