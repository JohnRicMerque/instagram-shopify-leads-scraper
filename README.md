# Instagram Shopify Leads Scraper

**Type a niche like "skincare" and get a ready-to-pitch lead list: online brands with a verified Shopify store, matched Instagram profile, public email and phone, engagement stats, and a 0–100 lead score explaining exactly why each one made the cut.**

Add a whole list of niches in one run (`skincare`, `clean beauty`, `haircare`, ...). Each is searched separately, then merged and de-duplicated so every brand is scored only once.

Built for agencies, Shopify app developers, email marketers, and B2B sales teams.

> ## Actively maintained: recent improvements
>
> - **Lower run cost.** Residential proxy traffic (the expensive kind) is now used only where Instagram and search engines actually require it. Ordinary store pages, product feeds, and contact pages route through cheap datacenter IPs automatically, no setup needed.
> - **Spending cap notice.** If a run hits its "Maximum cost per run" limit, it now stops cleanly and says so in plain language, instead of silently returning fewer leads than expected.
> - **Cleaner lead list.** Platform badges like the "Powered by Shopify" footer link no longer get mistaken for a store's own Instagram account, and off-topic stores that just happen to mention your keyword once are filtered out before they reach your dataset.

---

## Why it beats a plain Instagram scraper

A plain Instagram scraper hands you profiles and leaves you to open every bio link by hand to see who actually runs a store. This one does the qualifying for you:

- **Verifies Shopify for real.** Not a URL guess: CDN assets, checkout tokens, storefront APIs, and more, cross-checked. Every row lists the exact signals and a confidence score.
- **Finds brands your keyword would miss.** Add a few seed usernames and discovery follows Instagram's own "similar accounts" suggestions, catching brands that never use your exact keyword in their bio.
- **Scores and explains every lead.** A 0–100 score with plain-English reasons (`Confirmed Shopify store`, `Public business email available`, ...), so you know why to pitch, not just who.

---

## What you get

One row per business, streamed into the dataset while the run is going:

- **Store**: website URL, platform (`Shopify`, `WooCommerce`, ...), Shopify confidence with the exact detection signals, product count, currency, and installed apps (Klaviyo, Judge.me, Gorgias, and 15+ more)
- **Contacts**: public email (with an `emailVerified` deliverability check), phone, contact page
- **Instagram**: profile, follower count, latest post date, engagement rate, recent hashtags
- **Lead score**: transparent 0–100 score with plain-language reasons, tiered High / Medium / Low

By default every lead is a **verified Shopify store with a matched Instagram account**. Prefer volume over strictness? One dropdown loosens it, all the way to keeping every business found. Each row reports both sides either way, so you can slice the list any way you need.

---

## How to use

1. Enter **search terms** (e.g. `skincare`, `handmade jewelry`), optionally with locations. Also add 2–3 **Instagram usernames** of brands you like, highly recommended, the Actor uses them to find similar brands. Hashtags or profile URLs work too.
2. Pick **how many leads to collect** and **which businesses to keep** (default: Shopify stores that have Instagram).
3. Run. Export from the dataset when done, or while it runs.

---

## How it works

1. Searches two ways at once: finds Shopify storefronts on the open web first (footprints like "powered by Shopify"), and finds Instagram profiles from your search terms, hashtags, or seed usernames.
2. Every storefront candidate is verified as Shopify using multiple independent signals, never a URL pattern alone.
3. Each store's real Instagram account is located from its site (platform badge links like the Shopify footer are ignored), and each Instagram profile's bio link is resolved back to its store, including Linktree, Beacons, and other link-in-bio pages.
4. Recent posts are analyzed for activity and engagement; the site is checked for public contact info.
5. Every business is scored 0–100 with plain-language reasons and streamed into the dataset the moment it's ready.

---

## Input

Only one discovery source is required: search terms, hashtags, usernames, or profile URLs. Everything else has working defaults.

```json
{
    "searchTerms": ["skincare", "organic skincare"],
    "locations": ["United Kingdom"],
    "usernames": ["examplebrand"],
    "hashtags": ["skincarebrand"],
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
| `usernames` / `startUrls` | array | none | Instagram accounts to process directly, and the best lever for lead quality: 2–3 seeds unlock similar-account discovery. |
| `hashtags` | array | none | Instagram hashtags, with or without `#`. |
| `maxResults` | integer | 10 | Stop after saving this many leads. |
| `leadType` | select | `shopify-instagram` | What a business must have to count as a lead. Stricter = fewer, better leads; looser = more rows to sift yourself. |
| `onlyActiveProfiles` | boolean | false | Require a post within the last 30 days. |
| `requireEmail` | boolean | false | Require a public email. |
| `skipPreviousLeads` | boolean | false | Only return leads never exported by a previous run. Great for weekly prospecting. |
| `resetLeadsHistory` | boolean | false | Forget all previously exported leads before this run. |
| `excludedUsernames` / `excludedDomains` | array | none | Accounts and domains to skip. |
| `includeIncompleteLeads` | boolean | false | Advanced. Also save rows missing a website, contacts, or full profile data. |
| `discoveryMode` | select | `auto` | Advanced. `auto`, `shopify-first`, `instagram-first`, or `both`. |
| `googleApiKey` + `googleCseId` | string | none | Advanced. Your own free Google Custom Search key for deeper, more stable discovery. |
| `instagramSessionCookies` | string | none | Advanced. Optional throwaway-account cookie for better Instagram coverage. |
| `proxyConfiguration` | object | residential | Keep the default. Residential is used only where Instagram and search engines need it; store pages use cheap datacenter IPs automatically. |

---

## Output

One dataset row per business. The dataset's default table view shows the 15 columns that matter most for triage (score, tier, Shopify, store URL, email, phone, followers, engagement, ...); every field below is still in the full record. Fields that could not be determined are `null`, never guessed:

```json
{
    "searchTerm": "skincare",
    "locationQuery": "United Kingdom",
    "discoveryMethod": "shopify-first",
    "instagramUrl": "https://www.instagram.com/examplebrand/",
    "username": "examplebrand",
    "fullName": "Example Brand",
    "biography": "Independent skincare products.",
    "category": "Health/beauty",
    "isBusinessAccount": true,
    "isProfessionalAccount": true,
    "isVerified": false,
    "followersCount": 18400,
    "followingCount": 420,
    "postsCount": 386,
    "profileImageUrl": "https://.../examplebrand-profile.jpg",
    "latestPostDate": "2026-07-15T10:30:00.000Z",
    "postsLast30Days": 9,
    "averageLikes": 510,
    "averageComments": 28,
    "averageEngagementRate": 2.92,
    "isActive": true,
    "contentTypes": ["image", "carousel"],
    "recentCaptions": ["New drop is here..."],
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
    "emailVerified": true,
    "publicEmail": "hello@examplebrand.com",
    "publicPhone": null,
    "contactPageUrl": "https://examplebrand.com/pages/contact",
    "websiteTitle": "Example Brand | Independent Skincare",
    "websiteDescription": "Clean, independent skincare made in small batches.",
    "websiteBusinessName": "Example Brand Ltd",
    "websiteSocialLinks": ["https://www.instagram.com/examplebrand/"],
    "locationHints": ["United Kingdom"],
    "scrapedAt": "2026-07-19T08:30:00.000Z",
    "error": null,
    "leadScore": 88,
    "leadTier": "High",
    "leadReasons": ["Confirmed Shopify store", "Public business email available", "Instagram profile posted within the last seven days"]
}
```

A machine-readable run summary is also stored in the key-value store under `RUN-SUMMARY`:

```json
{
    "profilesDiscovered": 150,
    "profilesProcessed": 132,
    "profilesSkipped": 4,
    "websitesInspected": 104,
    "shopifyStoresFound": 67,
    "leadsSaved": 100,
    "leadsWithEmail": 48,
    "highQualityLeads": 39,
    "duplicatesRemoved": 11,
    "failedRequests": 7,
    "storeCandidatesChecked": 210,
    "storeCandidatesRejected": 118,
    "storeCandidatesOffTopic": 25,
    "storesWithoutInstagram": 12,
    "incompleteLeadsSkipped": 6,
    "discoveryMode": "auto",
    "chargeLimitReached": false,
    "filteredOut": {
        "followers": 0, "notShopify": 21, "noInstagram": 12, "inactive": 0,
        "noEmail": 0, "belowMinScore": 0, "excluded": 0, "location": 0, "previouslyExported": 0
    }
}
```

---

## Lead score

| Category | Max | Awarded for |
|---|---|---|
| Commerce fit | 35 | Confirmed Shopify +30 (store on another platform +15), reachable site +5 |
| Contactability | 25 | Email +15, phone +5, contact page +5 |
| Instagram activity | 25 | Posted within 7 days +15 (30 days +8), engagement up to +10 |
| Business quality | 15 | Business account +5, complete bio and website +5, followers in range +5 |

Tiers: High 75–100, Medium 45–74, Low 0–44. Every row includes the reasons behind its score.

---

## FAQ

**Do I need to touch the proxy settings?**
No. Residential is the default and works out of the box. To keep cost down, only Instagram and search-engine requests actually use it; ordinary store pages route through cheap datacenter IPs automatically.

**Why did I get fewer leads than requested?**
Usually the strict default (Shopify and Instagram both required) genuinely ran out of matching businesses for that niche. Loosen "Which businesses to keep", add more search terms, or add seed usernames. The end-of-run log and the `RUN-SUMMARY` record always explain which case happened, and if a spending cap was hit first, the status message says so directly instead of leaving you guessing.

**What's the difference between the four "Which businesses to keep" options?**
"Shopify stores that have Instagram" (default) is the strictest: fewest but best leads, every row is a verified store you can also reach by DM. "Has Instagram" adds businesses on other platforms or with no store yet. "Verified Shopify store" adds stores with no Instagram link and runs the faster store-first discovery. "All businesses" keeps everything found. Every row reports both sides regardless, so you can filter the dataset yourself afterwards.

**Do I need the Google API key?**
No. Discovery works without it using multiple free search engines. Adding your own free Google Custom Search key (100 queries/day) gives a deeper, more stable extra source, useful for larger or more competitive niches. Setup steps are below.

**Do I need Instagram session cookies?**
No, never required. It's an optional way to improve hashtag discovery coverage and reduce login walls if the log shows a lot of blocked requests. Use a throwaway account, never your personal one.

**What happens if a run hits its spending cap?**
It stops cleanly. The status and the `RUN-SUMMARY` (`chargeLimitReached: true`) say so, instead of the run silently returning fewer leads than expected. Raise "Maximum cost per run" to collect more in one go.

**A repeat run returned nothing. Is it broken?**
No. "Only new leads" is on and everything found was already exported by a previous run, which is exactly what it's meant to do for weekly prospecting. Turn it off, or enable "Reset lead memory" to start over.

**Why aren't the results 100% literal matches to my keyword?**
That's by design. Discovery also expands to Instagram's own "similar accounts" suggestions and niche hashtags actually used by the brands it finds, surfacing businesses that never use your exact keyword in their bio. Add 2–3 seed usernames to steer this even further toward brands you already like.

**Is this allowed?**
Only publicly visible information is collected: no private profiles, stories, DMs, or follower lists. You are responsible for using the data in line with Instagram's terms and applicable anti-spam and privacy laws (GDPR, CCPA, CAN-SPAM) in your outreach.

---

## Get a free Google Custom Search key (optional, 2 minutes)

Adds a deeper, more stable discovery source on top of the built-in search engines. Free, 100 queries/day.

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and create a project.
2. **APIs & Services > Library > "Custom Search API" > Enable.**
3. **Credentials > Create credentials > API key.** Copy it into `googleApiKey`.
4. Create a search engine that searches the entire web at **[programmablesearchengine.google.com](https://programmablesearchengine.google.com)**, then copy its Search engine ID into `googleCseId`.

---

## Use cases

- Shopify app developers building targeted outbound lists of stores that could use their app
- Agencies and freelancers pitching Instagram-native brands on design, ads, or email marketing
- Email marketers building segmented prospect lists with verified public emails
- B2B sales teams researching a niche before outreach
- Market research: gauge how many active Shopify brands exist in a niche and how they engage on Instagram

---

## Limitations

- Instagram limits public data: activity metrics come from the up to 12 recent posts it exposes, and some profiles return limited data when the API is blocked (noted in the row's `error` field); the Actor falls back to the HTML profile page in that case.
- Search engines occasionally block automated queries. The Actor already retries across four engines and multiple pages, but a very obscure niche can still return fewer candidates than a common one.
- Shopify is confirmed by real technical signals (CDN assets, checkout tokens, storefront APIs), never a URL pattern alone, but a store that deliberately hides all of them can be missed.
- `productCount` is capped at 30 per store to keep runs fast and affordable; a value of 30 means 30 or more products.
- Store-first leads without an Instagram link have empty Instagram columns; profiles without a website have empty store columns, never guessed.

---

## Feedback

Bug reports, feature requests, and use-case tips are welcome. Email the developer at [leafydevjr@gmail.com](mailto:leafydevjr@gmail.com).
