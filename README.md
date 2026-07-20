# Instagram Shopify Leads Scraper

**Type a niche like "skincare" and get a ready-to-use lead list: online brands with their store links (Shopify verified), Instagram profiles, public emails and phones, engagement stats, and a 0–100 lead score. One clean row per business, ready to export to CSV, Excel, or JSON for outreach.**

Built for agencies, Shopify app developers, email marketers, and B2B sales teams.

## What you get

One row per business, streamed into the dataset while the run is going:

- **Store**: website URL, platform (`Shopify`, `WooCommerce`, ...), Shopify confidence with the exact detection signals, product count, currency, and installed apps (Klaviyo, Judge.me, Gorgias, and 15+ more)
- **Contacts**: public email (with `emailVerified` deliverability check), phone, contact page
- **Instagram**: profile, follower count, latest post date, engagement rate, recent hashtags
- **Lead score**: transparent 0–100 score with plain-language reasons, tiered High / Medium / Low

By default every lead is a **verified Shopify store with a matched Instagram account**. Prefer volume over strictness? One dropdown loosens it, all the way to keeping every business found. Each row reports both sides either way, so you can slice the list any way you need. See the full sample row in [Output](#output) below.

## How to use

1. Enter **search terms** (e.g. `skincare`, `handmade jewelry`), optionally with locations. Also add 2–3 **Instagram usernames** of brands you like, highly recommended, the Actor uses them to find similar brands. Hashtags or profile URLs work too.
2. Pick **how many leads to collect** and **which businesses to keep** (default: Shopify stores that have Instagram).
3. Run. Export from the dataset when done (or while it runs).

### Options worth knowing

- **Which businesses to keep** (main form): **Shopify stores that have Instagram** (default) returns the fewest but best leads; every row is a verified store you can also reach through DMs. **Has Instagram** adds businesses on other platforms or with no store yet, ideal if you sell web services. **Verified Shopify store** adds stores without an Instagram link and uses the faster store-first discovery. **All businesses** returns the most rows and lets you filter the dataset yourself. Rule of thumb: stricter choice = fewer, better leads; looser choice = more rows to sift.
- **Only new leads**: repeat runs skip everything you already exported. Ideal for weekly prospecting. **Reset lead memory** starts the memory over. Both are checkboxes in the **Filters** section of the input form.
- **Seed usernames (highly recommended)**: add 2–3 Instagram accounts of brands you like into the **Instagram usernames** field on the main form. The Actor uses them to find similar brands via Instagram's own suggestions, which consistently turns up better, less obvious matches than keywords alone, on top of whatever search terms find. Works even without search terms.
- **Google API key**: plug your own free Google Custom Search key and engine ID into the **Google API key** and **Google search engine ID** fields in the **Advanced** section for deeper, more stable discovery. The field descriptions link to where you create both.
- **Proxies**: keep the default residential proxy, preset in **Proxy configuration** at the bottom of the **Advanced** section. Instagram blocks most datacenter IPs; on those the Actor continues with reduced profile data. To keep costs low, residential IPs are only used where they are needed (Instagram and search engines); ordinary store pages are fetched through cheap datacenter IPs automatically.
- **Instagram cookies** (optional): paste a throwaway account's session cookie into **Instagram session cookies** in the **Advanced** section to improve Instagram coverage. Never required.

## Input

Only one discovery source is required: search terms, hashtags, usernames, or profile URLs. Everything else has working defaults. Adding a few seed `usernames` alongside your search terms is highly recommended, it is the single best lever for lead quality.

```json
{
    "searchTerms": ["skincare", "organic skincare"],
    "locations": ["United Kingdom"],
    "hashtags": ["skincarebrand"],
    "usernames": ["examplebrand"],
    "startUrls": [{ "url": "https://www.instagram.com/examplebrand/" }],
    "maxResults": 10,
    "leadType": "shopify-instagram",
    "onlyActiveProfiles": false,
    "requireEmail": false,
    "skipPreviousLeads": false,
    "resetLeadsHistory": false,
    "excludedUsernames": ["mycompetitor"],
    "excludedDomains": ["alreadyacustomer.com"],
    "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

| Field | Type | Default | What it does |
|---|---|---|---|
| `searchTerms` | array | none | Niche keywords to discover businesses from. |
| `locations` | array | none | Countries or cities combined with each search term. |
| `hashtags` | array | none | Instagram hashtags, with or without `#`. |
| `usernames` / `startUrls` | array | none | Specific Instagram accounts to process (also great as similarity seeds). |
| `maxResults` | integer | 10 | Stop after saving this many leads. |
| `leadType` | select | `shopify-instagram` | `shopify-instagram` (verified Shopify store AND Instagram), `instagram` (Instagram, any platform), `shopify` (Shopify, Instagram optional), or `all` (keep everything). |
| `onlyActiveProfiles` | boolean | false | Require a post within the last 30 days. |
| `requireEmail` | boolean | false | Require a public email. |
| `skipPreviousLeads` | boolean | false | Only return leads never exported by a previous run. |
| `resetLeadsHistory` | boolean | false | Forget all previously exported leads before this run. |
| `excludedUsernames` / `excludedDomains` | array | none | Accounts and domains to skip. |
| `includeIncompleteLeads` | boolean | false | Advanced: also save rows with no website, contacts, or full profile data (skipped by default so they never crowd out actionable leads). |
| `discoveryMode` | select | `auto` | Advanced: `auto`, `shopify-first`, `instagram-first`, or `both`. |
| `googleApiKey` + `googleCseId` | string | none | Advanced: your own Google Custom Search key for deeper discovery. |
| `instagramSessionCookies` | string | none | Advanced: optional throwaway-account cookie for better Instagram coverage. |
| `proxyConfiguration` | object | residential | Keep the residential default for Instagram. |

## Output

One dataset row per business. Fields that could not be determined are `null` (never guessed):

```json
{
    "searchTerm": "skincare",
    "locationQuery": "United Kingdom",
    "discoveryMethod": "shopify-first",
    "username": "examplebrand",
    "instagramUrl": "https://www.instagram.com/examplebrand/",
    "fullName": "Example Brand",
    "biography": "Independent skincare products.",
    "category": "Health/beauty",
    "isBusinessAccount": true,
    "isVerified": false,
    "followersCount": 18400,
    "followingCount": 420,
    "postsCount": 386,
    "latestPostDate": "2026-07-15T10:30:00.000Z",
    "postsLast30Days": 9,
    "averageLikes": 510,
    "averageComments": 28,
    "averageEngagementRate": 2.92,
    "isActive": true,
    "recentHashtags": ["#skincare", "#glowup"],
    "originalBioUrl": "https://linktr.ee/examplebrand",
    "bioLinkService": "Linktree",
    "resolvedStoreUrl": "https://examplebrand.com/",
    "websiteDomain": "examplebrand.com",
    "websitePlatform": "Shopify",
    "isShopify": true,
    "shopifyConfidence": 0.98,
    "shopifySignals": ["cdn.shopify.com asset detected", "Shopify JavaScript object detected (window.Shopify / Shopify.theme)"],
    "hasOnlineStore": true,
    "websiteReachable": true,
    "websiteUsesHttps": true,
    "productCount": 28,
    "detectedApps": ["Klaviyo", "Judge.me"],
    "storeCurrency": "GBP",
    "publicEmail": "hello@examplebrand.com",
    "emailVerified": true,
    "publicPhone": null,
    "contactPageUrl": "https://examplebrand.com/pages/contact",
    "websiteTitle": "Example Brand | Independent Skincare",
    "leadScore": 88,
    "leadTier": "High",
    "leadReasons": ["Confirmed Shopify store", "Public business email available", "Instagram profile posted within the last seven days"],
    "relatedInstagramAccounts": [],
    "scrapedAt": "2026-07-17T08:30:00.000Z",
    "error": null
}
```

A machine-readable run summary is also stored in the key-value store under `RUN-SUMMARY`:

```json
{
    "profilesDiscovered": 150,
    "profilesProcessed": 132,
    "websitesInspected": 104,
    "shopifyStoresFound": 67,
    "leadsSaved": 100,
    "leadsWithEmail": 48,
    "highQualityLeads": 39,
    "duplicatesRemoved": 11,
    "failedRequests": 7,
    "filteredOut": { "notShopify": 21, "noEmail": 0, "previouslyExported": 0 }
}
```

## How leads are found

Two pipelines run together: one finds storefronts on the open web and verifies Shopify before ever touching Instagram; the other finds Instagram profiles and follows their bio links (Linktree, Beacons, and other link-in-bio services included) to the store. Discovery keeps widening (more result pages, related profiles, niche hashtags) until your lead target is reached.

Shopify is confirmed by multiple independent signals (CDN assets, checkout tokens, storefront APIs, and more), never by a URL pattern alone. Each row lists the exact signals and a 0–1 confidence.

## Lead score

| Category | Max | Awarded for |
|---|---|---|
| Commerce fit | 35 | Confirmed Shopify +30 (store on another platform +15), reachable site +5 |
| Contactability | 25 | Email +15, phone +5, contact page +5 |
| Instagram activity | 25 | Posted within 7 days +15 (30 days +8), engagement up to +10 |
| Business quality | 15 | Business account +5, complete bio and website +5, followers in range +5 |

Tiers: High 75–100, Medium 45–74, Low 0–44. Every row includes the reasons behind its score.

## Good to know

- Only publicly accessible information is collected. No private profiles, stories, DMs, or follower lists.
- Instagram limits public data: activity metrics come from the up-to-12 recent posts it exposes, and some profiles may return limited data (noted in the row's `error` field).
- Store-first leads without an Instagram link have empty Instagram columns; profiles without a website have empty store columns.
- `productCount` comes from the store's public product feed and is capped at 30, so a value of 30 means 30 or more products.
- You are responsible for using the data lawfully: comply with Instagram's terms, GDPR/CCPA, and anti-spam laws in your outreach.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Many `401` warnings in the log | Instagram is blocking your proxy IPs. Keep RESIDENTIAL proxies (the default); the run still continues with reduced profile data. |
| Fewer leads than requested | Expected with the strict default (Shopify + Instagram). The end-of-run log shows a filtered-out breakdown; loosen "Which businesses to keep" or broaden search terms for more rows. |
| Repeat run returns nothing | "Only new leads" is on and everything was already exported. Turn it off or enable "Reset lead memory". |
| Results feel too literal to the keyword | Add 2–3 seed usernames of brands you like; similar-brand discovery does the rest. |

## Feedback

Bug reports, feature requests, and use-case tips are welcome. Email the developer at [leafydevjr@gmail.com](mailto:leafydevjr@gmail.com).
