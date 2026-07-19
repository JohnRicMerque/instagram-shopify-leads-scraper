/**
 * E-commerce platform detection. Shopify is detected from multiple
 * independent signals (assets, JS objects, meta tags, headers, cookies,
 * hosting patterns) — never from a URL path alone.
 */
import { normalizeDomain } from '../utils/normalize.js';

// Each signal: id, human-readable description, confidence weight, matcher.
const SHOPIFY_SIGNALS = [
    {
        id: 'cdn-asset',
        description: 'cdn.shopify.com asset detected',
        weight: 0.35,
        test: ({ html }) => /cdn\.shopify\.com|cdn\.shopifycdn\.net/i.test(html),
    },
    {
        id: 'shopify-object',
        description: 'Shopify JavaScript object detected (window.Shopify / Shopify.theme)',
        weight: 0.35,
        test: ({ html }) => /window\.Shopify|Shopify\.theme|Shopify\.shop\s*=/.test(html),
    },
    {
        id: 'checkout-token',
        description: 'shopify-checkout-api-token meta tag detected',
        weight: 0.3,
        test: ({ html }) => /shopify-checkout-api-token/i.test(html),
    },
    {
        id: 'digital-wallet',
        description: 'shopify-digital-wallet meta tag detected',
        weight: 0.25,
        test: ({ html }) => /shopify-digital-wallet/i.test(html),
    },
    {
        id: 'cdn-shop-path',
        description: 'Shopify /cdn/shop/ asset path detected',
        weight: 0.2,
        test: ({ html }) => /\/cdn\/shop\/(files|t|products)\//i.test(html),
    },
    {
        id: 'shop-pay',
        description: 'Shop Pay reference detected',
        weight: 0.15,
        test: ({ html }) => /shop[\s_-]?pay|shopifypay/i.test(html),
    },
    {
        id: 'analytics',
        description: 'Shopify analytics (trekkie/monorail) detected',
        weight: 0.2,
        test: ({ html }) => /trekkie|monorail-edge\.shopifysvc\.com|Shopify\.analytics/i.test(html),
    },
    {
        id: 'powered-by',
        description: '"Powered by Shopify" text detected',
        weight: 0.2,
        test: ({ html }) => /powered by shopify/i.test(html),
    },
    {
        id: 'myshopify-domain',
        description: 'myshopify.com hosting domain detected',
        weight: 0.6,
        test: ({ html, url }) => /\.myshopify\.com/i.test(url) || /['"][a-z0-9-]+\.myshopify\.com/i.test(html),
    },
    {
        id: 'shopify-headers',
        description: 'Shopify HTTP response headers detected',
        weight: 0.5,
        test: ({ headers }) => {
            const keys = Object.keys(headers ?? {}).map((k) => k.toLowerCase());
            return keys.some((k) => k === 'x-shopify-stage' || k === 'x-sorting-hat-shopid'
                || k === 'x-shopid' || k === 'x-sorting-hat-podid');
        },
    },
    {
        id: 'shopify-cookies',
        description: 'Shopify session cookies detected',
        weight: 0.3,
        test: ({ headers }) => {
            const setCookie = headers?.['set-cookie'];
            const cookies = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
            return /_shopify_[sy]|cart_currency|shopify_pay/i.test(cookies);
        },
    },
    {
        id: 'storefront-routes',
        description: 'Shopify storefront routes (/collections/, /cart) detected',
        weight: 0.1, // deliberately weak — URL paths alone must never confirm Shopify
        test: ({ html }) => /href="[^"]*\/collections\/[^"]*"/i.test(html) && /\/cart/i.test(html),
    },
];

const OTHER_PLATFORMS = [
    {
        platform: 'WooCommerce',
        test: ({ html }) => /woocommerce/i.test(html) && /wp-content|wp-includes/i.test(html),
    },
    {
        platform: 'Wix',
        test: ({ html, headers }) => /wix\.com|wixstatic\.com|wixsite\.com/i.test(html)
            || Object.keys(headers ?? {}).some((k) => k.toLowerCase().startsWith('x-wix')),
    },
    {
        platform: 'Squarespace',
        test: ({ html }) => /static1\.squarespace\.com|squarespace\.com\/static|this is squarespace/i.test(html),
    },
    {
        platform: 'BigCommerce',
        test: ({ html }) => /cdn\d*\.bigcommerce\.com|bigcommerce\.com\/stencil/i.test(html),
    },
    {
        platform: 'Webflow',
        test: ({ html }) => /assets(-global)?\.website-files\.com|data-wf-site/i.test(html),
    },
    {
        platform: 'Ecwid',
        test: ({ html }) => /app\.ecwid\.com|ecwid\.com\/script/i.test(html),
    },
    {
        platform: 'Big Cartel',
        test: ({ url, html }) => /bigcartel\.com/i.test(url) || /bigcartel\.com/i.test(html),
    },
    {
        platform: 'Etsy',
        test: ({ url }) => /(^|\.)etsy\.com/i.test(normalizeDomain(url) ?? ''),
    },
    {
        platform: 'Amazon',
        test: ({ url }) => /(^|\.)amazon\.[a-z.]+$/i.test(normalizeDomain(url) ?? ''),
    },
];

const STORE_HINT_RE = /add[\s-]?to[\s-]?cart|data-product-id|\/checkout\b|class="[^"]*cart|id="cart|our\s+products|shop\s+now/i;

/**
 * Detect the website platform from HTML + response headers + final URL.
 *
 * @param {string} html page body
 * @param {object} headers response headers (lowercase keys preferred)
 * @param {string} url final loaded URL
 * @returns {{
 *   platform: string, isShopify: boolean, shopifyConfidence: number,
 *   shopifySignals: string[], hasOnlineStore: boolean, inconclusiveShopify: boolean
 * }}
 */
export function detectPlatform(html, headers, url) {
    const ctx = { html: html ?? '', headers: headers ?? {}, url: url ?? '' };

    const matched = SHOPIFY_SIGNALS.filter((signal) => {
        try {
            return signal.test(ctx);
        } catch {
            return false;
        }
    });

    const confidence = Math.min(1, matched.reduce((sum, s) => sum + s.weight, 0));
    const roundedConfidence = Math.round(confidence * 100) / 100;

    // Require at least two independent signals, or the near-certain
    // myshopify.com hosting signal, before confirming Shopify.
    const hasStrongSignal = matched.some((s) => s.id === 'myshopify-domain' || s.id === 'shopify-headers');
    const isShopify = (matched.length >= 2 && confidence >= 0.5) || (hasStrongSignal && matched.length >= 2)
        || matched.some((s) => s.id === 'myshopify-domain');

    let platform = 'Unknown';
    if (isShopify) {
        platform = 'Shopify';
    } else {
        for (const candidate of OTHER_PLATFORMS) {
            try {
                if (candidate.test(ctx)) {
                    platform = candidate.platform;
                    break;
                }
            } catch { /* ignore matcher errors */ }
        }
    }

    const hasOnlineStore = isShopify
        || ['WooCommerce', 'BigCommerce', 'Ecwid', 'Big Cartel', 'Etsy', 'Amazon'].includes(platform)
        || STORE_HINT_RE.test(ctx.html);

    return {
        platform,
        isShopify,
        shopifyConfidence: roundedConfidence,
        shopifySignals: matched.map((s) => s.description),
        hasOnlineStore,
        // One weak-to-medium signal: worth confirming via /products.json.
        inconclusiveShopify: !isShopify && matched.length === 1 && confidence >= 0.1,
    };
}

// Well-known e-commerce app/tool footprints. Agencies and app developers
// prospect by installed stack ("stores using Klaviyo"), and these signals
// are free — the homepage HTML is already in hand.
const APP_SIGNATURES = [
    ['Klaviyo', /klaviyo\.com\/onsite|klaviyo\.js|_learnq|klaviyo\.init/i],
    ['Mailchimp', /chimpstatic\.com|mcjs\.js|mailchimp/i],
    ['Omnisend', /omnisend/i],
    ['Privy', /privy\.com|privy-widget/i],
    ['Judge.me', /judge\.me/i],
    ['Loox', /loox\.io/i],
    ['Yotpo', /yotpo/i],
    ['Stamped.io', /stamped\.io/i],
    ['Okendo', /okendo/i],
    ['Gorgias', /gorgias/i],
    ['Tidio', /tidio/i],
    ['Zendesk', /zdassets\.com|zopim/i],
    ['Recharge', /rechargepayments\.com|rechargecdn/i],
    ['Smile.io', /smile\.io|sweettooth/i],
    ['AfterShip', /aftership/i],
    ['Klarna', /klarna/i],
    ['Afterpay/Clearpay', /afterpay|clearpay/i],
    ['Sezzle', /sezzle/i],
    ['Hotjar', /hotjar/i],
    ['Google Analytics', /googletagmanager\.com|google-analytics\.com/i],
    ['Meta Pixel', /connect\.facebook\.net[^"']*fbevents|fbq\(/i],
];

const CURRENCY_PATTERNS = [
    /Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/,
    /"cart_currency"\s*:\s*"([A-Z]{3})"/,
    /"currency"\s*:\s*"([A-Z]{3})"/,
    /property="og:price:currency"\s+content="([A-Z]{3})"/i,
];

/**
 * Extract store-intelligence signals from a storefront's HTML:
 * detected marketing/support/review apps and the store currency.
 */
export function detectStoreIntelligence(html) {
    const text = html ?? '';
    const detectedApps = APP_SIGNATURES
        .filter(([, pattern]) => pattern.test(text))
        .map(([name]) => name);

    let storeCurrency = null;
    for (const pattern of CURRENCY_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            storeCurrency = match[1];
            break;
        }
    }

    return { detectedApps, storeCurrency };
}

/**
 * Parse a Shopify /products.json response used as a confirmation probe.
 * Returns { confirmed, productCount } — confirmed only when the payload
 * has the exact Shopify products shape.
 */
export function parseProductsJson(json) {
    if (!json || typeof json !== 'object' || !Array.isArray(json.products)) {
        return { confirmed: false, productCount: null };
    }
    const looksShopify = json.products.length === 0
        || json.products.every((p) => p && typeof p === 'object' && 'handle' in p && 'variants' in p);
    return {
        confirmed: looksShopify && json.products.length > 0,
        productCount: looksShopify ? json.products.length : null,
    };
}
