# gsc-mcp-connector

> Self-hosted Google Search Console MCP server, deployable to Cloudflare Workers in 15 minutes. Plug it into ChatGPT, Claude, or any MCP-capable client and query your GSC data in natural language.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JuJu78/gsc-mcp-connector)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What this gives you

Once deployed, you get a private MCP endpoint that exposes 30 tools to your AI assistant across Search Console, Google Analytics 4, Google Ads Keyword Planner, Google Autocomplete, SERP analysis, Market Gap Intelligence, and DataForSEO Backlinks & Rankings:

### DataForSEO Intelligence (Backlinks, Keyword Difficulty & Live SERP)
- `dataforseo_backlinks_summary` — complete domain or URL backlink overview: domain authority rank (0–1000), 0–100 authority score, total backlinks count, referring domains, referring IPs, broken links/pages, dofollow vs nofollow breakdown, and top referring TLDs.
- `dataforseo_backlinks_list` — list individual backlinks pointing to target domain/URL with anchor text, source URL, target URL, dofollow status, authority rank, page/domain rank, spam score, and status.
- `dataforseo_referring_domains` — list referring domains pointing to target domain/URL with domain authority rank, backlinks count, referring pages, broken backlinks, and spam scores.
- `dataforseo_keyword_difficulty` — official DataForSEO 0–100 Keyword Difficulty (KD) scores, difficulty tier ('Very Easy' to 'Very Hard'), and ranking effort estimates for single or bulk keywords.
- `dataforseo_serp_who_is_ranking` — query live Google organic SERP to see who is ranking for any keyword: top ranking domains/URLs, titles, snippets, plus detection of AI Overviews, Featured Snippets, People Also Ask, and Reddit/Forum discussions.
- `dataforseo_serp_competitors` — identify top competitor domains ranking across one or multiple search keywords in Google, including average ranking position, rating, visibility, and estimated traffic volume (ETV).
- `dataforseo_domain_ranked_keywords` — discover organic Google search keywords that any target domain or competitor ranks for, including keyword, rank position, ranking URL, search volume, CPC, keyword difficulty (KD), and estimated traffic.

### Google Search Console & Opportunity Finder
- `list_sites` — discover every property accessible to the authenticated user
- `query_search_analytics` — clicks, impressions, CTR, position, filterable by query / page / country / device / search appearance / date
- `inspect_url` — full URL Inspection API output (indexing status, canonical, mobile, AMP)
- `list_sitemaps` — every submitted sitemap and its processing status
- `gsc_find_striking_distance_keywords` — identify keywords ranking in positions 8 to 20 with high impressions to unlock immediate page 1 traffic gains
- `gsc_find_keyword_cannibalization` — detect internal URLs competing for the same queries and get canonical/redirect fix recommendations

### Google Analytics 4 (GA4)
- `ga4_list_properties` — list all GA4 properties and IDs accessible to the user
- `ga4_run_report` — query GA4 metrics (users, sessions, pageviews, conversions, revenue) grouped by dimensions
- `ga4_run_realtime_report` — query real-time activity for the last 30 minutes

### Microsoft Clarity (UX & Behavioral Insights)
- `clarity_list_projects` — list all configured Microsoft Clarity projects and aliases (`aiskyla`, `openrees`, `calorieinsight`, etc.)
- `clarity_get_live_insights` — fetch live traffic, bot sessions, and user behavior metrics (Rage Clicks, Dead Clicks, Excessive Scrolling, Quick Backs) across Device, URL, Browser, OS, Country, Source, Medium, Campaign, and Channel
- `clarity_get_ux_friction_summary` — analyze user friction, compute a 0–100 Friction Score, and rank top problem URLs and devices
- `clarity_save_project` — dynamically save or update additional Clarity project API tokens into Cloudflare KV via chat


### Google Ads Keyword Planner (Search Volume & Traffic)
- `google_ads_list_accessible_customers` — list accessible Google Ads customer IDs
- `google_ads_get_keyword_traffic` — check exact search volume traffic, 12-month monthly historical breakdown, competition index (0-100), and top-of-page CPC bid estimates for target keywords
- `google_ads_generate_keyword_ideas` — generate new keyword ideas with search volume, competition, and CPC ranges from seed keywords or a website URL

### Google Autocomplete Engine (100% Free)
- `google_autocomplete_expand` — discover surging zero-competition long-tail search queries via Google's real-time Suggest engine across alphabet (a-z), questions, comparisons, or commercial intent

### Google SERP, AI Overview & Competition Analysis
- `serpapi_google_search` — direct Google search via SerpApi returning top 10 organic results, page titles, URLs, domains, snippets, AI Overview, featured snippets, and knowledge graph.
- `serperdev_google_search` — direct Google search via Serper.dev returning top 10 organic results, page titles, URLs, domains, snippets, AI Overview, featured snippets, and knowledge graph.
- `get_serp_overview` — check whether Google provides an AI Overview (SGE), Featured Snippet, Knowledge Graph, or organic top rankings for target keywords with intelligent hybrid auto-fallback (SerpApi primary with automatic Serper.dev fallback).
- `analyze_keyword_competition` — analyze SERP competition and ranking opportunity for a keyword. Inspects top 10 competitors, domain diversity, presence of UGC / forum discussions (Reddit, Quora), major authority domains (Wikipedia, Gov), and AI Overviews to produce an actionable ranking opportunity assessment.
- `check_keyword_difficulty` — calculate an accurate 0–100 Keyword Difficulty (KD) score for single or batch queries. Evaluates top 10 competitor domain authorities (mega-authorities vs. niche vs. UGC/Reddit/Quora content gaps), competitor title optimization ratios, SERP feature saturation, backlink requirements, and actionable SEO recommendations.
- `check_serp_overview` — alias for `get_serp_overview` supporting single or batch keyword lists.

### Market Gap & Ranking Opportunity Intelligence
- `find_reddit_forum_content_gaps` — scan keywords to find queries where Reddit, Quora, or discussion forums rank in the top 3–5, signaling an immediate editorial content gap
- `get_people_also_ask_tree` — extract the complete People Also Ask (PAA) question tree with user intent classification and generate ready-to-use JSON-LD FAQPage schema
- `detect_serp_freshness_gaps` — detect outdated search results (competitor content $\le$ 2023) to capitalize on Google's freshness ranking bonus
- `find_high_cpc_low_kd_keywords` — the "Golden Ratio" commercial opportunity hunter: finds keywords with high advertiser CPC and search volume, but low SEO Keyword Difficulty (KD $\le$ 45)

You ask: *"Quelles sont mes 50 requêtes avec la plus grosse perte de clics entre les 28 derniers jours et les 28 jours précédents ?"* and the assistant pulls the data, computes the delta, and writes the analysis. No more SQL exports.

## How it works

```
ChatGPT/Claude  ──OAuth──▶  Your Worker  ──OAuth──▶  Google
                                 │
                                 └─ holds your Google refresh_token
                                    (encrypted, in OAuth grant props)
```

Two OAuth chains :
1. **MCP client → Worker** : ChatGPT/Claude do OAuth 2.1 + PKCE against your Worker. The login UI asks for a static "access key" you set at deploy time (the connector gate).
2. **Worker → Google** : after the access key check, the user is redirected to Google's consent screen to grant `webmasters.readonly`. The resulting refresh token is stored in the OAuth grant; on every tool call, the Worker refreshes a fresh access token and calls GSC.

The user's Google account drives access — no Service Account, no GSC user-management dance, no permission propagation delays.

## Prerequisites

| Item | Cost | Required ? |
|---|---|---|
| ChatGPT Plus / Pro / Team **or** Claude.ai Pro / Team | $20/mo+ | Custom MCP connectors are gated on paid plans. |
| Cloudflare account | Free tier is enough | Yes |
| Google Cloud project | Free | Yes — to create an OAuth Client |
| Verified Search Console property | Free | Yes (you already have it) |
| Node.js 20+ + `wrangler` CLI | Free | Recommended for the secret-setting steps |

The Cloudflare Workers free tier (100k requests/day) is largely enough for personal SEO usage. **No paid Cloudflare plan needed.**

## Quick start (~15 min)

### 1. Deploy the Worker

Click the **Deploy to Cloudflare** button at the top of this README. Cloudflare clones the repo into your account, installs deps, and gives you a public URL like `https://gsc-mcp-connector.<your-subdomain>.workers.dev`.

> **Note** : at this stage, you'll be asked for `MCP_BEARER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET`. You don't have the Google ones yet — fill `MCP_BEARER_TOKEN` with any random hex string for now (you can change later), and paste anything in the two Google fields. We'll set them properly in step 4.
>
> If you'd rather skip the button, clone the repo locally, run `npm install`, then `npx wrangler deploy`.

After deployment, **note your Worker URL**. You will need it both in step 3 and in step 5.

### 2. Generate a connector access key

This is a static random string used as a gate before Google OAuth. Anyone using the connector must paste this string in the login UI.

```bash
openssl rand -hex 32
```

Save the output — you'll set it as a secret and use it in ChatGPT/Claude.

### 3. Set up Google Cloud (OAuth Client)

Follow the step-by-step in [docs/SETUP_GCP.md](docs/SETUP_GCP.md). Use **your Worker URL from step 1** in the Authorized redirect URI. You'll end up with a **Client ID** and a **Client Secret**.

This is the longest step (~10 min the first time) but you only do it once.

### 4. Configure the Worker secrets

```bash
npx wrangler secret put MCP_BEARER_TOKEN
# paste the value from step 2

npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
# paste the Client ID from step 3

npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
# paste the Client Secret from step 3

# Optional: Google Ads API Developer Token (for Keyword Planner traffic tools)
npx wrangler secret put GOOGLE_ADS_DEVELOPER_TOKEN

# Optional: SERP & AI Overview Checker Keys
# Primary (250 free/month recurring):
npx wrangler secret put SERPAPI_API_KEY
# Fallback (2,500 free queries + $0.001/query):
npx wrangler secret put SERPER_API_KEY

# Optional: DataForSEO v3 (for Backlinks, Keyword Difficulty & SERP Rankings)
npx wrangler secret put DATAFORSEO_LOGIN
npx wrangler secret put DATAFORSEO_PASSWORD
# Or Base64 combined key:
npx wrangler secret put DATAFORSEO_API_KEY
```

Or via the Cloudflare dashboard : **Workers & Pages** → your worker → **Settings** → **Variables and Secrets** → add each as type **Secret**.

> **Tip — encoding pitfall on Windows** : if you pipe a file's content (e.g. `Get-Content | wrangler secret put`) and that file has a UTF-8 BOM, the BOM ends up in your secret and breaks JSON parsing. The Cloudflare dashboard or interactive `wrangler secret put` (paste at the prompt) avoids this entirely.

### 5. Plug into ChatGPT (Plus/Pro/Team)

ChatGPT → **Settings** → **Connectors** → **Add custom connector** :

- **Name** : `gsc`
- **MCP Server URL** : `https://YOUR-WORKER-URL/mcp` (must end with `/mcp`)
- **Authentication** : `OAuth`
- Check "I understand and want to continue"
- **Create**

A popup opens to your Worker's login UI. Paste your `MCP_BEARER_TOKEN` → click **Continue with Google →** → Google asks you to log in (use the account that owns your GSC property) and grant `webmasters.readonly` → you're redirected back to ChatGPT, connector is active.

In a new chat, **enable the `gsc` connector** in the toolbar, then ask: *"List my Google Search Console sites"*. You should see your properties.

### 6. (Optional) Plug into Claude.ai (Pro/Team)

**Settings** → **Integrations** → **Add custom integration** → same URL, same flow.

## Local development

```bash
git clone https://github.com/JuJu78/gsc-mcp-connector
cd gsc-mcp-connector
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars with your real Client ID + Client Secret + bearer token
npx wrangler dev
```

The dev server runs on `http://localhost:8787`. Note that local dev cannot fully complete the Google OAuth flow because Google's redirect URIs require HTTPS. For a true end-to-end test, deploy to Cloudflare and test against the workers.dev URL.

## Limitations

- **Read-only.** Adding write operations (submit sitemap, request indexing) is left out by design — they're risky in an LLM context. Open a PR if you need them.
- **Single-tenant by design.** One operator deploys, one bearer token gates the connector, the access is bound to whoever completes the Google OAuth dance. Multi-user SaaS-style is out of scope.
- **OAuth consent in *Testing* mode** caps you at 100 test users (more than enough for personal/team use). For broader distribution you'd need to submit the app for Google verification (`webmasters.readonly` is a "sensitive" scope, requires manual review).
- **GSC API quotas** — 1200 queries/min/project, 30k/day. Plenty for interactive use.
- **Date range** — GSC returns the last 16 months. Earlier dates error.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error 400: redirect_uri_mismatch` during Google login | Authorized redirect URI in GCP doesn't exactly match what the Worker sends | Verify `https://YOUR-WORKER/oauth/google/callback` is configured *as-is* in [GCP Credentials](https://console.cloud.google.com/apis/credentials) |
| `Error 403: access_denied` after Google login | Logged-in account isn't in *Test users* of the OAuth consent screen | Add the Gmail in [OAuth consent screen → Audience → Test users](https://console.cloud.google.com/apis/credentials/consent) |
| `something went wrong` after authorization in ChatGPT | Stale OAuth grant from a previous attempt | Delete the connector in ChatGPT and recreate it |
| `No Google refresh token in grant. Re-authorize` | The grant was created before you deployed v0.4+ | Delete the connector in ChatGPT/Claude and recreate it |
| `Invalid access key. Try again.` after pasting the bearer | `MCP_BEARER_TOKEN` mismatch between secret and what you pasted | Re-set the secret via interactive `wrangler secret put` (avoid file-pipe to prevent BOM/newline pollution) |
| `tools/call list_sites` returns `{}` | Authenticated Google account has no GSC properties (or wrong account) | Verify which account you used in the Google consent step — it must own GSC properties |
| ChatGPT says "no tools available" | URL doesn't end with `/mcp` | Server URL must be `https://YOUR-WORKER/mcp`, not the bare root |

## Stack

- **Cloudflare Workers** + Durable Objects (via [`agents`](https://github.com/cloudflare/agents) SDK ≥0.12)
- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) for OAuth 2.1 + DCR + PKCE
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) for tool definitions
- KV namespace `OAUTH_KV` for OAuth state
- Google OAuth 2.0 flow signed natively via Web Crypto API (no Node deps)

## Credits

Built by [Julien Gourdon](https://julien-gourdon.fr) — SEO consultant exploring the intersection of search and AI.

## License

MIT — see [LICENSE](LICENSE).
