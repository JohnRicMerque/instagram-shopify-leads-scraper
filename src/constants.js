/**
 * Shared constants: request labels, Instagram endpoints, known domain lists.
 */

export const LABELS = {
    SEARCH: 'SEARCH',
    TOPSEARCH: 'TOPSEARCH',
    HASHTAG: 'HASHTAG',
    PROFILE: 'PROFILE',
    PROFILE_HTML: 'PROFILE_HTML',
    WEBSITE: 'WEBSITE',
    PRODUCTS_JSON: 'PRODUCTS_JSON',
    CONTACT_PAGE: 'CONTACT_PAGE',
    // Shopify-first (reverse) pipeline: find stores on the web first,
    // then locate their Instagram account.
    STORE_SEARCH: 'STORE_SEARCH',
    STORE_CHECK: 'STORE_CHECK',
    // Optional Google Custom Search discovery (user-supplied API key).
    GOOGLE_SEARCH: 'GOOGLE_SEARCH',
};

// Request labels that must go through the user-configured proxy pool
// (RESIDENTIAL by default): Instagram rejects datacenter IPs outright and
// search engines captcha-wall them. Everything else (store pages,
// products.json, contact pages) rides cheap datacenter IPs — residential
// traffic is billed per GB at roughly 40x the datacenter rate, and store
// pages are the bulk of the bytes.
export const PREMIUM_PROXY_LABELS = new Set([
    LABELS.PROFILE, LABELS.PROFILE_HTML, LABELS.HASHTAG, LABELS.TOPSEARCH,
    LABELS.SEARCH, LABELS.STORE_SEARCH,
]);

// Page size for the /products.json confirmation probe. It only needs to
// prove the Shopify products shape and give a rough catalog size; the API
// maximum of 250 returns multi-MB payloads on big stores for no extra
// signal. productCount is therefore capped at this value ("30+" stores).
export const PRODUCTS_JSON_LIMIT = 30;

// Instagram accounts of platforms/tools, not businesses. Store footers
// often link these ("powered by Shopify" badge -> instagram.com/shopify),
// so they must never be matched as a store's own account.
export const PLATFORM_IG_ACCOUNTS = new Set([
    'shopify', 'shopifyplus', 'shopify_partners', 'instagram', 'facebook',
    'meta', 'wix', 'squarespace', 'woocommerce', 'bigcommerce', 'webflow',
    'etsy', 'amazon', 'google', 'apple', 'microsoft', 'paypal', 'stripe',
    'klarna', 'afterpay', 'klaviyo', 'mailchimp', 'canva', 'shop',
]);

// Named key-value store shared across all runs of this Actor on the same
// account — powers the "only new leads" cross-run deduplication.
export const HISTORY_STORE_NAME = 'instagram-shopify-leads-history';
export const HISTORY_KEY = 'EXPORTED';

// Public web-app ID Instagram's own frontend sends with every request.
export const IG_APP_ID = '936619743392459';

export const IG_PROFILE_API = (username) =>
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

export const IG_HASHTAG_API = (tag) =>
    `https://www.instagram.com/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`;

// Instagram's own public keyword search (accounts + hashtags). Works
// anonymously from some IPs; login-walled from others — treated as a
// best-effort discovery source with search engines as the backbone.
export const IG_TOPSEARCH_API = (query) =>
    `https://www.instagram.com/web/search/topsearch/?context=blended&count=50&query=${encodeURIComponent(query)}`;

export const IG_PROFILE_URL = (username) => `https://www.instagram.com/${username}/`;

// Path segments on instagram.com that are NOT usernames.
export const RESERVED_IG_PATHS = new Set([
    'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'about', 'legal',
    'directory', 'developer', 'blog', 'api', 'graphql', 'static', 'help', 'privacy',
    'terms', 'session', 'login', 'challenge', 'web', 'locations', 'tags', 's',
    'invites', 'ar', 'oauth', 'emails', 'push', 'settings', 'topics', 'lite',
    'download', 'nametag', 'guides', 'direct', 'your_activity', 'data', 'sem',
    'ads', 'press', 'apps', 'contact', 'support', 'security', 'community',
    'creators', 'business', 'instagram', 'features', 'linkshim', 'popular',
    'jobs', 'positions', 'wifiauth', 'igtv',
]);

// Known link-in-bio hosts -> human-readable service name.
export const LINK_IN_BIO_HOSTS = {
    'linktr.ee': 'Linktree',
    'linktree.com': 'Linktree',
    'beacons.ai': 'Beacons',
    'beacons.page': 'Beacons',
    'stan.store': 'Stan',
    'linkin.bio': 'Later Linkin.bio',
    'campsite.bio': 'Campsite',
    'campsite.to': 'Campsite',
    'withkoji.com': 'Koji',
    'koji.to': 'Koji',
    'taplink.cc': 'Taplink',
    'taplink.at': 'Taplink',
    'bio.site': 'Bio Site',
    'lnk.bio': 'Lnk.Bio',
    'milkshake.app': 'Milkshake',
    'msha.ke': 'Milkshake',
    'solo.to': 'Solo',
    'allmylinks.com': 'AllMyLinks',
    'direct.me': 'Direct.me',
    'hoo.be': 'Hoo.be',
    'snipfeed.co': 'Snipfeed',
    'liinks.co': 'Liinks',
    'flowpage.com': 'Flowpage',
    'tap.bio': 'Tap.bio',
    'linkpop.com': 'Linkpop',
};

// Domains never treated as business-website candidates when found on
// link-in-bio pages (social networks, messengers, payment, media platforms).
export const IGNORED_OUTBOUND_DOMAINS = new Set([
    'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'messenger.com',
    'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be',
    'pinterest.com', 'snapchat.com', 'linkedin.com', 'threads.net', 'threads.com',
    'wa.me', 'whatsapp.com', 'api.whatsapp.com', 't.me', 'telegram.me', 'telegram.org',
    'discord.gg', 'discord.com', 'reddit.com', 'tumblr.com', 'vk.com',
    'spotify.com', 'open.spotify.com', 'music.apple.com', 'podcasts.apple.com',
    'soundcloud.com', 'twitch.tv', 'onlyfans.com', 'fansly.com',
    'patreon.com', 'buymeacoffee.com', 'ko-fi.com', 'gofundme.com',
    'paypal.com', 'paypal.me', 'venmo.com', 'cash.app', 'wise.com',
    'eventbrite.com', 'calendly.com', 'zoom.us', 'meet.google.com',
    'play.google.com', 'apps.apple.com', 'itunes.apple.com',
    'goo.gl', 'forms.gle', 'docs.google.com', 'drive.google.com',
    'bit.ly', 'tinyurl.com', 'substack.com', 'medium.com',
]);

// Domains that can never be an SMB Shopify storefront — filtered out of
// store-search results to save requests (search engines, marketplaces,
// big retailers, content/review sites). Anything that slips through is
// still rejected by the multi-signal Shopify check.
export const NON_STORE_DOMAINS = new Set([
    ...IGNORED_OUTBOUND_DOMAINS,
    'google.com', 'bing.com', 'duckduckgo.com', 'mojeek.com', 'yahoo.com',
    'yandex.com', 'baidu.com', 'microsoft.com', 'msn.com', 'apple.com',
    'wikipedia.org', 'wikimedia.org', 'fandom.com', 'quora.com',
    'stackexchange.com', 'stackoverflow.com', 'github.com', 'archive.org',
    'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
    'ebay.com', 'aliexpress.com', 'alibaba.com', 'walmart.com', 'target.com',
    'bestbuy.com', 'temu.com', 'shein.com', 'rakuten.com', 'flipkart.com',
    'trustpilot.com', 'sitejabber.com', 'yelp.com', 'tripadvisor.com',
    'glassdoor.com', 'indeed.com', 'crunchbase.com',
    'shopify.com', 'shopify.dev', 'wordpress.com', 'wordpress.org',
    'blogspot.com', 'wix.com', 'squarespace.com', 'godaddy.com', 'webflow.com',
    'forbes.com', 'businessinsider.com', 'nytimes.com', 'theguardian.com',
    'buzzfeed.com', 'cosmopolitan.com', 'allure.com', 'byrdie.com',
    'healthline.com', 'vogue.com', 'elle.com', 'refinery29.com',
    'goodhousekeeping.com', 'sephora.com', 'ulta.com', 'boots.com',
    'lookfantastic.com', 'cultbeauty.com', 'dermstore.com', 'beautybay.com',
    'spacenk.com', 'nykaa.com', 'reuters.com', 'apnews.com', 'bbc.com',
    'bbc.co.uk', 'cnn.com',
]);

// Labels that signal a store/website link on a link-in-bio page.
export const PRIORITY_LINK_REGEX =
    /\b(shop|store|website|official|site|products?|collections?|catalog|buy|order|browse|boutique)\b/i;

// Multiple interchangeable engines: any one of them being rate-limited or
// captcha-walled must not kill discovery.
export const SEARCH_ENGINE_BUILDERS = {
    duckduckgo: (query, page = 1) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        + (page > 1 ? `&s=${(page - 1) * 30}&dc=${(page - 1) * 30 + 1}` : ''),
    'duckduckgo-lite': (query, page = 1) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
        + (page > 1 ? `&s=${(page - 1) * 30}&dc=${(page - 1) * 30 + 1}` : ''),
    bing: (query, page = 1) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30`
        + (page > 1 ? `&first=${(page - 1) * 30 + 1}` : ''),
    mojeek: (query, page = 1) => `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`
        + (page > 1 ? `&s=${(page - 1) * 10 + 1}` : ''),
};

// Keep paging search results (per engine per query) until the lead quota
// or the discovery cap is reached.
export const MAX_SEARCH_PAGES = 5;

// Discovery expansion guards: mega-brand accounts suggest other mega-brands
// (rarely Shopify SMB leads), so don't expand from them, and take only the
// first few related profiles per account.
export const MAX_RELATED_PER_PROFILE = 5;
export const EXPANSION_MAX_FOLLOWERS = 1_000_000;

export const RUN_SUMMARY_KEY = 'RUN-SUMMARY';

// --- Discovery auto-expansion -------------------------------------------
// A co-occurring hashtag is explored once this many discovered profiles
// have used it in their recent posts.
export const HASHTAG_EXPAND_THRESHOLD = 3;
export const MAX_HASHTAG_EXPANSIONS = 8;

// Mega-generic hashtags that would explode discovery with irrelevant
// profiles — never used for snowball expansion.
export const GENERIC_HASHTAGS = new Set([
    'love', 'instagood', 'instagram', 'photooftheday', 'picoftheday', 'follow',
    'followme', 'like4like', 'likeforlike', 'instadaily', 'reels', 'reelsinstagram',
    'explore', 'explorepage', 'viral', 'trending', 'fyp', 'foryou', 'foryoupage',
    'photography', 'happy', 'style', 'life', 'lifestyle', 'beautiful', 'art',
    'sale', 'shop', 'shopping', 'shoplocal', 'smallbusiness', 'business',
    'entrepreneur', 'giveaway', 'ootd', 'fashion', 'beauty', 'model', 'cute',
    'nature', 'travel', 'fitness', 'motivation', 'monday', 'weekend', 'summer',
    'winter', 'spring', 'autumn', 'newpost', 'new', 'link', 'linkinbio',
]);
