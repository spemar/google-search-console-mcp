import {
  OAuthProvider,
  type AuthRequest,
  type ClientInfo,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  buildAuthorizeUrl,
  exchangeCode,
  getValidAccessToken,
  type GoogleOAuthConfig,
} from "./google_auth";
import {
  inspectUrl,
  listSitemaps,
  listSites,
  querySearchAnalytics,
} from "./gsc";
import {
  listGA4Properties,
  queryGA4Report,
  queryGA4Realtime,
} from "./ga4";
import {
  listAccessibleCustomers,
  getKeywordHistoricalMetrics,
  generateKeywordIdeas,
} from "./google_ads";
import {
  checkBatchSerpOverview,
  fetchSerpApi,
  fetchSerperDev,
  analyzeKeywordCompetition,
  checkBatchKeywordDifficulty,
  checkKeywordDifficulty,
} from "./serp";
import {
  findStrikingDistanceKeywords,
  findKeywordCannibalization,
} from "./gsc_opportunities";
import {
  expandAutocomplete,
} from "./autocomplete";
import {
  findRedditForumContentGaps,
  getPeopleAlsoAskTree,
  detectSerpFreshnessGaps,
  findHighCpcLowKdKeywords,
} from "./market_gaps";
import {
  fetchClarityLiveInsights,
  listAllClarityProjects,
  resolveClarityToken,
  saveProjectTokenToKV,
  deleteProjectTokenFromKV,
  summarizeUxFriction,
} from "./clarity";
import {
  resolveDataForSeoAuth,
  getDataForSeoBacklinksSummary,
  getDataForSeoBacklinksList,
  getDataForSeoReferringDomains,
  getDataForSeoKeywordDifficulty,
  getDataForSeoSerpWhoIsRanking,
  getDataForSeoSerpCompetitors,
  getDataForSeoRankedKeywords,
} from "./dataforseo";
import {
  writeSeoContent,
} from "./writer";

interface Env {
  // OAuth Client (operator's Google project)
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;

  // Google Ads API (operator defaults)
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_API_VERSION?: string;

  // SERP & AI Overview API keys (optional; operator defaults)
  SERPAPI_API_KEY?: string;
  SERPER_API_KEY?: string;

  // Microsoft Clarity API (optional operator defaults / multi-project JSON map)
  CLARITY_API_TOKEN?: string;
  CLARITY_PROJECT_TOKENS?: string;

  // DataForSEO v3 API (optional operator defaults for Backlinks, KD, SERP)
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  DATAFORSEO_API_KEY?: string;
  // Anthropic — BodyNutrition SEO Writer
ANTHROPIC_API_KEY?: string;

  // Connector access gate (operator-set; users paste this in the login UI)
  MCP_BEARER_TOKEN: string;

  // Cloudflare bindings
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_OBJECT: DurableObjectNamespace;
}

interface GrantProps {
  googleRefreshToken: string;
  grantedAt: number;
  [key: string]: unknown;
}

function cleanSecret(val: unknown): string {
  if (typeof val !== "string") return "";
  return val
    .replace(/^[\uFEFF\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n]/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function googleConfigFromEnv(env: Env, request: Request): GoogleOAuthConfig {
  const url = new URL(request.url);
  return {
    clientId: cleanSecret(env.GOOGLE_OAUTH_CLIENT_ID),
    clientSecret: cleanSecret(env.GOOGLE_OAUTH_CLIENT_SECRET),
    redirectUri: `${url.origin}/oauth/google/callback`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MCP Agent — exposes 4 GSC tools. Reads Google refresh_token from props.
// ────────────────────────────────────────────────────────────────────────────

const dimensionSchema = z.enum([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
  "date",
]);

const searchTypeSchema = z.enum([
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
]);

function asJsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export class GSCMCP extends McpAgent<Env, unknown, GrantProps> {
  server = new McpServer({
    name: "gsc-mcp-connector",
    version: "0.4.1",
  });

  private async accessToken(): Promise<string> {
    const refreshToken = this.props?.googleRefreshToken;
    if (!refreshToken) {
      throw new Error(
        "No Google refresh token in grant. Re-authorize the connector.",
      );
    }
    return getValidAccessToken(
      {
        clientId: cleanSecret(this.env.GOOGLE_OAUTH_CLIENT_ID),
        clientSecret: cleanSecret(this.env.GOOGLE_OAUTH_CLIENT_SECRET),
        redirectUri: "unused-during-refresh",
      },
      refreshToken,
    );
  }

  async init() {
    this.server.tool(
      "list_sites",
      "List every Search Console property the authenticated user has access to. Use this first to discover available siteUrl values.",
      {},
      async () => {
        const token = await this.accessToken();
        const data = await listSites(token);
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "query_search_analytics",
      "Query Google Search Console performance data (clicks, impressions, CTR, average position) for a site. Supports breakdown by query, page, country, device, search appearance, or date.",
      {
        siteUrl: z
          .string()
          .describe(
            "Property identifier (e.g. 'sc-domain:example.com' for a Domain property, or 'https://example.com/' for a URL-prefix property). Get this from list_sites.",
          ),
        startDate: z.string().describe("Start date (YYYY-MM-DD, inclusive)"),
        endDate: z.string().describe("End date (YYYY-MM-DD, inclusive)"),
        dimensions: z
          .array(dimensionSchema)
          .optional()
          .describe("Up to 3 dimensions to group by"),
        type: searchTypeSchema
          .optional()
          .describe("Search type filter (default: web)"),
        rowLimit: z
          .number()
          .int()
          .min(1)
          .max(25000)
          .optional()
          .describe("Max rows to return (default 1000, max 25000)"),
        startRow: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset (default 0)"),
        dataState: z
          .enum(["final", "all"])
          .optional()
          .describe("'all' includes fresh data; 'final' is the default"),
        aggregationType: z
          .enum(["auto", "byPage", "byProperty"])
          .optional()
          .describe("How metrics are aggregated"),
        filterDimension: dimensionSchema
          .optional()
          .describe("Optional single-filter convenience: dimension to filter on"),
        filterOperator: z
          .enum([
            "equals",
            "notEquals",
            "contains",
            "notContains",
            "includingRegex",
            "excludingRegex",
          ])
          .optional()
          .describe("Optional single-filter convenience: operator"),
        filterExpression: z
          .string()
          .optional()
          .describe("Optional single-filter convenience: expression"),
      },
      async (args) => {
        const token = await this.accessToken();
        const {
          siteUrl,
          filterDimension,
          filterOperator,
          filterExpression,
          ...rest
        } = args;

        const body: Parameters<typeof querySearchAnalytics>[2] = {
          startDate: rest.startDate,
          endDate: rest.endDate,
          dimensions: rest.dimensions,
          type: rest.type,
          rowLimit: rest.rowLimit ?? 1000,
          startRow: rest.startRow ?? 0,
          dataState: rest.dataState,
          aggregationType: rest.aggregationType,
        };

        if (filterDimension && filterExpression) {
          body.dimensionFilterGroups = [
            {
              groupType: "and",
              filters: [
                {
                  dimension: filterDimension,
                  operator: filterOperator ?? "equals",
                  expression: filterExpression,
                },
              ],
            },
          ];
        }

        const data = await querySearchAnalytics(token, siteUrl, body);
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "inspect_url",
      "Run the URL Inspection API on a single URL: indexing status, last crawl, canonical, mobile usability, AMP and rich-result issues.",
      {
        siteUrl: z
          .string()
          .describe("Property identifier owning the URL (e.g. 'sc-domain:example.com')"),
        inspectionUrl: z
          .string()
          .describe("Fully-qualified URL to inspect, must belong to siteUrl"),
        languageCode: z
          .string()
          .optional()
          .describe("BCP-47 language code, default 'en-US'"),
      },
      async (args) => {
        const token = await this.accessToken();
        const data = await inspectUrl(token, {
          siteUrl: args.siteUrl,
          inspectionUrl: args.inspectionUrl,
          languageCode: args.languageCode ?? "en-US",
        });
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "list_sitemaps",
      "List every sitemap submitted for a Search Console property, with last submission and processing status.",
      {
        siteUrl: z
          .string()
          .describe("Property identifier (e.g. 'sc-domain:example.com')"),
      },
      async (args) => {
        const token = await this.accessToken();
        const data = await listSitemaps(token, args.siteUrl);
        return asJsonContent(data);
      },
    );

    // ── GA4 Tools ────────────────────────────────────────────────────────────

    this.server.tool(
      "ga4_list_properties",
      "List all Google Analytics 4 (GA4) properties and numeric property IDs accessible to the authenticated user. Use this first to discover available propertyId values.",
      {},
      async () => {
        const token = await this.accessToken();
        const data = await listGA4Properties(token);
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "ga4_run_report",
      "Query Google Analytics 4 (GA4) performance metrics (activeUsers, sessions, screenPageViews, bounceRate, conversions, totalRevenue, eventCount) grouped by dimensions (date, pagePath, sessionSourceMedium, country, deviceCategory, defaultChannelGroup).",
      {
        propertyId: z
          .string()
          .describe("GA4 property ID (e.g. '123456789' or 'properties/123456789'). Get this from ga4_list_properties."),
        startDate: z
          .string()
          .describe("Start date (YYYY-MM-DD, or relative like 'today', 'yesterday', '7daysAgo', '30daysAgo')"),
        endDate: z
          .string()
          .describe("End date (YYYY-MM-DD, or relative like 'today', 'yesterday')"),
        metrics: z
          .array(z.string())
          .describe("Metrics to retrieve (e.g. ['activeUsers', 'sessions', 'screenPageViews', 'bounceRate', 'conversions'])"),
        dimensions: z
          .array(z.string())
          .optional()
          .describe("Dimensions to group by (e.g. ['pagePath', 'sessionSourceMedium', 'country', 'deviceCategory', 'date'])"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .optional()
          .describe("Max rows to return (default 1000, max 100000)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset (default 0)"),
        filterDimension: z
          .string()
          .optional()
          .describe("Optional dimension to filter on (e.g. 'country' or 'pagePath')"),
        filterValue: z
          .string()
          .optional()
          .describe("Optional filter string value"),
        filterMatchType: z
          .enum(["EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "FULL_REGEXP"])
          .optional()
          .describe("Filter match type (default: CONTAINS)"),
      },
      async (args) => {
        const token = await this.accessToken();
        let dimensionFilter: Record<string, unknown> | undefined;

        if (args.filterDimension && args.filterValue) {
          dimensionFilter = {
            filter: {
              fieldName: args.filterDimension,
              stringFilter: {
                matchType: args.filterMatchType ?? "CONTAINS",
                value: args.filterValue,
              },
            },
          };
        }

        const data = await queryGA4Report(token, {
          propertyId: args.propertyId,
          startDate: args.startDate,
          endDate: args.endDate,
          metrics: args.metrics,
          dimensions: args.dimensions,
          limit: args.limit,
          offset: args.offset,
          dimensionFilter,
        });
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "ga4_run_realtime_report",
      "Query real-time Google Analytics 4 (GA4) traffic and activity for the last 30 minutes.",
      {
        propertyId: z
          .string()
          .describe("GA4 property ID (e.g. '123456789'). Get this from ga4_list_properties."),
        metrics: z
          .array(z.string())
          .describe("Realtime metrics (e.g. ['activeUsers', 'eventCount'])"),
        dimensions: z
          .array(z.string())
          .optional()
          .describe("Realtime dimensions (e.g. ['country', 'city', 'unifiedScreenName', 'deviceCategory'])"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max rows to return (default 100)"),
      },
      async (args) => {
        const token = await this.accessToken();
        const data = await queryGA4Realtime(token, {
          propertyId: args.propertyId,
          metrics: args.metrics,
          dimensions: args.dimensions,
          limit: args.limit,
        });
        return asJsonContent(data);
      },
    );

    // ── Google Ads Keyword Planner Tools ─────────────────────────────────────

    this.server.tool(
      "google_ads_list_accessible_customers",
      "List all Google Ads customer accounts and numeric customer IDs accessible to the authenticated user. Use this first to discover available customerId values for Keyword Planner queries.",
      {
        developerToken: z
          .string()
          .optional()
          .describe("Google Ads developer token (optional if GOOGLE_ADS_DEVELOPER_TOKEN secret is configured)."),
        loginCustomerId: z
          .string()
          .optional()
          .describe("Manager account (MCC) customer ID if authenticating via manager (optional)."),
        apiVersion: z
          .string()
          .optional()
          .describe("Google Ads API version (e.g. 'v25', 'v24'). Defaults to 'v25' with automatic multi-version fallback."),
      },
      async (args) => {
        const token = await this.accessToken();
        const { developerToken, loginCustomerId, apiVersion } = this.getGoogleAdsConfig(
          args.developerToken,
          args.loginCustomerId,
          args.apiVersion,
        );
        const data = await listAccessibleCustomers({
          token,
          developerToken,
          loginCustomerId,
          apiVersion,
        });
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "google_ads_get_keyword_traffic",
      "Check exact search traffic volume, 12-month historical breakdown, competition level, competition index (0-100), and top-of-page CPC bid estimates for a specific list of keywords using Google Ads Keyword Planner.",
      {
        customerId: z
          .string()
          .describe("Google Ads 10-digit customer ID (e.g. '123-456-7890' or '1234567890'). Get this from google_ads_list_accessible_customers."),
        keywords: z
          .array(z.string())
          .min(1)
          .describe("List of keywords to check traffic volume and metrics for (e.g. ['surprise gift service', 'gift delivery'])."),
        geoTargetConstants: z
          .array(z.string())
          .optional()
          .describe("Optional target locations/countries (e.g. ['US', 'IN', 'UK', 'CA', 'AU', 'DE', 'FR'] or numeric criterion IDs like ['2840']). Default is all/global."),
        language: z
          .string()
          .optional()
          .describe("Optional language filter (e.g. 'en', 'es', 'fr', 'de', 'hi' or criterion ID like '1000'). Default is all/English."),
        keywordPlanNetwork: z
          .enum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"])
          .optional()
          .describe("Target search network (default: GOOGLE_SEARCH)."),
        includeAdultKeywords: z
          .boolean()
          .optional()
          .describe("Whether to include adult/sensitive keywords (default: false)."),
        developerToken: z
          .string()
          .optional()
          .describe("Google Ads developer token override (optional if configured in Worker secrets)."),
        loginCustomerId: z
          .string()
          .optional()
          .describe("Manager account (MCC) customer ID if accessing via manager account."),
        apiVersion: z
          .string()
          .optional()
          .describe("Google Ads API version (e.g. 'v25', 'v24'). Defaults to 'v25' with automatic multi-version fallback."),
      },
      async (args) => {
        const token = await this.accessToken();
        const { developerToken, loginCustomerId, apiVersion } = this.getGoogleAdsConfig(
          args.developerToken,
          args.loginCustomerId,
          args.apiVersion,
        );
        const data = await getKeywordHistoricalMetrics(
          {
            token,
            developerToken,
            loginCustomerId,
            apiVersion,
          },
          {
            customerId: args.customerId,
            keywords: args.keywords,
            geoTargetConstants: args.geoTargetConstants,
            language: args.language,
            keywordPlanNetwork: args.keywordPlanNetwork,
            includeAdultKeywords: args.includeAdultKeywords,
          },
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "google_ads_generate_keyword_ideas",
      "Generate new keyword ideas and search volume traffic metrics (monthly searches, competition, estimated top-of-page CPC bid ranges) from seed keywords and/or a website URL.",
      {
        customerId: z
          .string()
          .describe("Google Ads 10-digit customer ID (e.g. '1234567890'). Get this from google_ads_list_accessible_customers."),
        keywords: z
          .array(z.string())
          .optional()
          .describe("Seed keywords to generate ideas and traffic estimates from (e.g. ['marketing automation', 'crm'])."),
        url: z
          .string()
          .optional()
          .describe("Seed webpage URL to extract keywords and traffic estimates from."),
        site: z
          .string()
          .optional()
          .describe("Seed domain name for domain-level keyword ideas."),
        geoTargetConstants: z
          .array(z.string())
          .optional()
          .describe("Optional target locations/countries (e.g. ['US', 'IN', 'UK', 'CA', 'AU'] or numeric IDs)."),
        language: z
          .string()
          .optional()
          .describe("Optional language filter (e.g. 'en', 'es', 'fr', 'hi')."),
        keywordPlanNetwork: z
          .enum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"])
          .optional()
          .describe("Target search network (default: GOOGLE_SEARCH)."),
        includeAdultKeywords: z
          .boolean()
          .optional()
          .describe("Whether to include adult keywords (default: false)."),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Number of keyword ideas to return (default 50, max 1000)."),
        pageToken: z
          .string()
          .optional()
          .describe("Pagination token for fetching the next page of ideas."),
        developerToken: z
          .string()
          .optional()
          .describe("Google Ads developer token override (optional if configured in Worker secrets)."),
        loginCustomerId: z
          .string()
          .optional()
          .describe("Manager account (MCC) customer ID if accessing via manager account."),
        apiVersion: z
          .string()
          .optional()
          .describe("Google Ads API version (e.g. 'v25', 'v24'). Defaults to 'v25' with automatic multi-version fallback."),
      },
      async (args) => {
        const token = await this.accessToken();
        const { developerToken, loginCustomerId, apiVersion } = this.getGoogleAdsConfig(
          args.developerToken,
          args.loginCustomerId,
          args.apiVersion,
        );
        const data = await generateKeywordIdeas(
          {
            token,
            developerToken,
            loginCustomerId,
            apiVersion,
          },
          {
            customerId: args.customerId,
            keywords: args.keywords,
            url: args.url,
            site: args.site,
            geoTargetConstants: args.geoTargetConstants,
            language: args.language,
            keywordPlanNetwork: args.keywordPlanNetwork,
            includeAdultKeywords: args.includeAdultKeywords,
            pageSize: args.pageSize,
            pageToken: args.pageToken,
          },
        );
        return asJsonContent(data);
      },
    );

    // ── SERP & AI Overview Checker Tools ────────────────────────────────────

    this.server.tool(
      "serpapi_google_search",
      "Execute a live Google Search directly using SerpApi. Returns top 10 organic rankings with page titles, URLs, domains, snippets, AI Overview, featured snippet, and knowledge graph.",
      {
        query: z
          .string()
          .describe("The Google search query or keyword (e.g. 'best crm software')."),
        country: z
          .string()
          .optional()
          .describe("Two-letter country code (e.g. 'us', 'in', 'uk'). Default is 'us'."),
        language: z
          .string()
          .optional()
          .describe("Two-letter language code (e.g. 'en', 'es', 'fr'). Default is 'en'."),
        serpApiKey: z
          .string()
          .optional()
          .describe("Optional SerpApi key override (if not using Worker secret)."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, undefined);
        if (!serpConfig.serpApiKey) {
          throw new Error("SERPAPI_API_KEY is not configured in Worker secrets or provided as an argument.");
        }
        const data = await fetchSerpApi(
          args.query,
          args.country || "us",
          args.language || "en",
          serpConfig.serpApiKey,
        );
        return asJsonContent({
          provider: "serpapi",
          ...data,
        });
      },
    );

    this.server.tool(
      "serperdev_google_search",
      "Execute a live Google Search directly using Serper.dev. Returns top 10 organic rankings with page titles, URLs, domains, snippets, AI Overview, featured snippet, and knowledge graph.",
      {
        query: z
          .string()
          .describe("The Google search query or keyword (e.g. 'best standing desk')."),
        country: z
          .string()
          .optional()
          .describe("Two-letter country code (e.g. 'us', 'in', 'uk'). Default is 'us'."),
        language: z
          .string()
          .optional()
          .describe("Two-letter language code (e.g. 'en', 'es', 'fr'). Default is 'en'."),
        serperApiKey: z
          .string()
          .optional()
          .describe("Optional Serper.dev key override (if not using Worker secret)."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(undefined, args.serperApiKey);
        if (!serpConfig.serperApiKey) {
          throw new Error("SERPER_API_KEY is not configured in Worker secrets or provided as an argument.");
        }
        const data = await fetchSerperDev(
          args.query,
          args.country || "us",
          args.language || "en",
          serpConfig.serperApiKey,
        );
        return asJsonContent({
          provider: "serper",
          ...data,
        });
      },
    );

    this.server.tool(
      "get_serp_overview",
      "Check whether Google displays an AI Overview (SGE), Featured Snippet, Knowledge Graph, and top organic rankings for specified keyword(s). Supports dual-engine auto-fallback (SerpApi first; automatically switches to Serper.dev if quota is reached).",
      {
        keyword: z
          .string()
          .optional()
          .describe("Single keyword to check (e.g. 'best crm for startups')."),
        keywords: z
          .array(z.string())
          .optional()
          .describe("Array of keywords to check in batch (e.g. ['best crm for startups', 'best free crm'])."),
        country: z
          .string()
          .optional()
          .describe("Two-letter country code (e.g. 'us', 'in', 'uk'). Default is 'us'."),
        language: z
          .string()
          .optional()
          .describe("Two-letter language code (e.g. 'en', 'es', 'fr'). Default is 'en'."),
        provider: z
          .enum(["auto", "serpapi", "serper"])
          .optional()
          .describe("Search provider strategy: 'auto' (default: SerpApi with Serper.dev fallback), 'serpapi', or 'serper'."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const queryList: string[] = [];
        if (args.keyword) queryList.push(args.keyword);
        if (args.keywords && Array.isArray(args.keywords)) {
          for (const k of args.keywords) {
            if (k && !queryList.includes(k)) queryList.push(k);
          }
        }
        if (queryList.length === 0) {
          throw new Error("Provide at least one keyword via 'keyword' or 'keywords'.");
        }

        const results = await checkBatchSerpOverview(
          queryList,
          {
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
        );

        return asJsonContent({
          totalKeywords: results.length,
          keywordsWithAiOverview: results.filter((r) => r.hasAiOverview).length,
          keywordsWithFeaturedSnippet: results.filter((r) => r.hasFeaturedSnippet).length,
          keywordsWithKnowledgeGraph: results.filter((r) => r.hasKnowledgeGraph).length,
          results,
        });
      },
    );

    this.server.tool(
      "analyze_keyword_competition",
      "Analyze the SERP competition and ranking opportunity for a keyword. Inspects top 10 competitors, domain diversity, presence of forum/UGC discussions (Reddit, Quora), major authority domains (Wikipedia, Gov), and AI Overviews to produce an actionable ranking opportunity assessment.",
      {
        query: z
          .string()
          .describe("Target keyword or query to analyze (e.g. 'best ergonomic chair under 300')."),
        country: z
          .string()
          .optional()
          .describe("Two-letter country code (default 'us')."),
        language: z
          .string()
          .optional()
          .describe("Two-letter language code (default 'en')."),
        provider: z
          .enum(["auto", "serpapi", "serper"])
          .optional()
          .describe("Search provider strategy: 'auto' (default: SerpApi primary with automatic Serper.dev fallback), 'serpapi', or 'serper'."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const analysis = await analyzeKeywordCompetition(
          {
            query: args.query,
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
        );
        return asJsonContent(analysis);
      },
    );

    this.server.tool(
      "check_serp_overview",
      "Check whether Google displays an AI Overview (SGE), Featured Snippet, Knowledge Graph, and top organic search rankings for specified keyword(s). Employs hybrid auto-fallback (tries SerpApi first to use 250 monthly free searches; automatically switches to Serper.dev if SerpApi quota is reached or errors).",
      {
        keywords: z
          .array(z.string())
          .min(1)
          .describe("List of keywords or search queries to check (e.g. ['best crm for startups', 'how to tie a tie'])."),
        country: z
          .string()
          .optional()
          .describe("Two-letter country code for geo-targeted search results (e.g. 'us', 'in', 'uk', 'ca'). Default is 'us'."),
        language: z
          .string()
          .optional()
          .describe("Two-letter language code (e.g. 'en', 'es', 'fr', 'hi'). Default is 'en'."),
        provider: z
          .enum(["auto", "serpapi", "serper"])
          .optional()
          .describe("Search provider strategy: 'auto' (default: SerpApi primary with automatic Serper.dev fallback), 'serpapi', or 'serper'."),
        serpApiKey: z
          .string()
          .optional()
          .describe("Optional SerpApi key override (if not configured in Worker secrets)."),
        serperApiKey: z
          .string()
          .optional()
          .describe("Optional Serper.dev key override (if not configured in Worker secrets)."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const results = await checkBatchSerpOverview(
          args.keywords,
          {
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
        );

        return asJsonContent({
          totalKeywords: results.length,
          keywordsWithAiOverview: results.filter((r) => r.hasAiOverview).length,
          keywordsWithFeaturedSnippet: results.filter((r) => r.hasFeaturedSnippet).length,
          keywordsWithKnowledgeGraph: results.filter((r) => r.hasKnowledgeGraph).length,
          results,
        });
      },
    );

    this.server.tool(
      "check_keyword_difficulty",
      "Calculate an accurate 0–100 Keyword Difficulty (KD) score and competitive analysis for one or multiple keywords. Analyzes top 10 ranking competitors, weighted domain authorities (mega-authorities, niche sites, and UGC/Reddit/Quora signals), on-page title optimization ratios, SERP feature crowding (AI Overviews, featured snippets), and provides estimated backlink requirements and actionable ranking recommendations.",
      {
        keyword: z
          .string()
          .optional()
          .describe("Single target keyword or query to evaluate (e.g. 'best crm for startups')."),
        keywords: z
          .array(z.string())
          .optional()
          .describe("Multiple keywords to evaluate in batch (e.g. ['best crm for startups', 'open source crm'])."),
        country: z
          .string()
          .optional()
          .describe("Two-letter country code (e.g. 'us', 'in', 'uk'). Default is 'us'."),
        language: z
          .string()
          .optional()
          .describe("Two-letter language code (e.g. 'en', 'es', 'fr'). Default is 'en'."),
        provider: z
          .enum(["auto", "serpapi", "serper"])
          .optional()
          .describe("Search provider strategy: 'auto' (default: SerpApi with automatic Serper.dev fallback), 'serpapi', or 'serper'."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const queryList: string[] = [];
        if (args.keyword) queryList.push(args.keyword);
        if (args.keywords && Array.isArray(args.keywords)) {
          for (const k of args.keywords) {
            if (k && !queryList.includes(k)) queryList.push(k);
          }
        }
        if (queryList.length === 0) {
          throw new Error("Provide at least one keyword via 'keyword' or 'keywords'.");
        }

        const results = await checkBatchKeywordDifficulty(
          queryList,
          {
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
        );

        if (queryList.length === 1) {
          return asJsonContent(results[0]);
        }

        return asJsonContent({
          totalKeywords: results.length,
          averageDifficultyScore: Math.round(
            results.reduce((acc, r) => acc + r.difficultyScore, 0) / results.length,
          ),
          results,
        });
      },
    );

    // ── GSC Opportunities & Health Tools ────────────────────────────────────

    this.server.tool(
      "gsc_find_striking_distance_keywords",
      "Find high-opportunity 'striking distance' keywords from your Google Search Console data (positions 8 to 20 with high impressions). These are keywords where you already rank on page 2 or bottom of page 1, and small on-page optimizations (title, H2 expansion, internal links) can push them into the top 3 with massive traffic gains.",
      {
        siteUrl: z.string().describe("The Search Console property URL (e.g. 'https://example.com/' or 'sc-domain:example.com')."),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date (YYYY-MM-DD). Defaults to 28 days ago."),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date (YYYY-MM-DD). Defaults to 3 days ago."),
        minPosition: z.number().optional().describe("Minimum average position (default: 8.0)."),
        maxPosition: z.number().optional().describe("Maximum average position (default: 20.0)."),
        minImpressions: z.number().int().optional().describe("Minimum impressions threshold (default: 100)."),
        rowLimit: z.number().int().optional().describe("Maximum rows to fetch from GSC (default: 1000)."),
      },
      async (args) => {
        const token = await this.accessToken();
        const result = await findStrikingDistanceKeywords(token, {
          siteUrl: args.siteUrl,
          startDate: args.startDate,
          endDate: args.endDate,
          minPosition: args.minPosition,
          maxPosition: args.maxPosition,
          minImpressions: args.minImpressions,
          rowLimit: args.rowLimit,
        });
        return asJsonContent(result);
      },
    );

    this.server.tool(
      "gsc_find_keyword_cannibalization",
      "Detect keyword cannibalization across your site where multiple internal URLs are competing against each other for the exact same search query in Google Search Console. Identifies split impressions/clicks and recommends canonical, 301-redirect, or content differentiation fixes.",
      {
        siteUrl: z.string().describe("The Search Console property URL (e.g. 'https://example.com/' or 'sc-domain:example.com')."),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date (YYYY-MM-DD). Defaults to 28 days ago."),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date (YYYY-MM-DD). Defaults to 3 days ago."),
        minImpressions: z.number().int().optional().describe("Minimum total query impressions threshold (default: 50)."),
        rowLimit: z.number().int().optional().describe("Maximum rows to fetch from GSC (default: 2500)."),
      },
      async (args) => {
        const token = await this.accessToken();
        const result = await findKeywordCannibalization(token, {
          siteUrl: args.siteUrl,
          startDate: args.startDate,
          endDate: args.endDate,
          minImpressions: args.minImpressions,
          rowLimit: args.rowLimit,
        });
        return asJsonContent(result);
      },
    );

    // ── Free Google Autocomplete / Alphabet Soup Tool ───────────────────────

    this.server.tool(
      "google_autocomplete_expand",
      "Expand a seed keyword using Google's real-time Autocomplete / Suggest engine (100% free with infinite usage). Supports 'alphabet' soup expansion (a-z), 'questions' (how to, why, can), 'comparisons' (vs, alternative), 'commercial', or 'all' to discover fresh, zero-competition search queries.",
      {
        query: z.string().describe("Seed keyword or topic to expand (e.g. 'crm for startups', 'espresso machine')."),
        strategy: z
          .enum(["all", "alphabet", "questions", "comparisons", "commercial", "standard"])
          .optional()
          .describe("Expansion strategy: 'all' (default), 'alphabet' (a-z modifiers), 'questions', 'comparisons', 'commercial', or 'standard'."),
        country: z.string().optional().describe("Two-letter country code (default: 'us')."),
        language: z.string().optional().describe("Two-letter language code (default: 'en')."),
        maxResults: z.number().int().optional().describe("Maximum unique suggestions to return (default: 100)."),
      },
      async (args) => {
        const result = await expandAutocomplete({
          query: args.query,
          strategy: args.strategy,
          country: args.country,
          language: args.language,
          maxResults: args.maxResults,
        });
        return asJsonContent(result);
      },
    );

    // ── Market Gap & Opportunity Finders ────────────────────────────────────

    this.server.tool(
      "find_reddit_forum_content_gaps",
      "Scan keywords to discover content gaps on Google where Reddit, Quora, or discussion forums rank in positions 1 to 3 (or top 5). Since Google prioritizes user discussions when high-quality editorial guides are missing, these represent the highest-probability, easiest ranking opportunities.",
      {
        keywords: z
          .array(z.string())
          .min(1)
          .describe("List of keywords to scan for forum content gaps (e.g. ['best crm for pre-seed', 'how to hire first engineer'])."),
        country: z.string().optional().describe("Two-letter country code (default 'us')."),
        language: z.string().optional().describe("Two-letter language code (default 'en')."),
        maxPosition: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Maximum ranking position for forum to qualify as a gap (default: 5, use 3 for high-priority)."),
        provider: z.enum(["auto", "serpapi", "serper"]).optional().describe("SERP provider strategy (default: 'auto')."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const result = await findRedditForumContentGaps(
          args.keywords,
          {
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
          args.maxPosition ?? 5,
        );
        return asJsonContent(result);
      },
    );

    this.server.tool(
      "get_people_also_ask_tree",
      "Extract the full 'People Also Ask' (PAA) question tree from Google search results. Categorizes questions by user search intent (How-To, Definitions, Pricing/Costs, Comparisons), and generates ready-to-use JSON-LD FAQPage schema and recommended H2/H3 sub-headings.",
      {
        query: z.string().describe("Search query to extract PAA questions for (e.g. 'best ergonomic office chair')."),
        country: z.string().optional().describe("Two-letter country code (default 'us')."),
        language: z.string().optional().describe("Two-letter language code (default 'en')."),
        provider: z.enum(["auto", "serpapi", "serper"]).optional().describe("SERP provider (default: 'auto')."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const result = await getPeopleAlsoAskTree(
          {
            query: args.query,
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
        );
        return asJsonContent(result);
      },
    );

    this.server.tool(
      "detect_serp_freshness_gaps",
      "Detect outdated content and freshness gaps in Google search results. Analyzes competitor publication dates to identify keywords where top-ranking pages are 2+ years old (<= 2023), signaling an immediate opportunity to outrank them with a freshly updated current-year guide.",
      {
        keywords: z
          .array(z.string())
          .min(1)
          .describe("List of keywords to evaluate for freshness gaps (e.g. ['best react state management', 'seo trends'])."),
        country: z.string().optional().describe("Two-letter country code (default 'us')."),
        language: z.string().optional().describe("Two-letter language code (default 'en')."),
        provider: z.enum(["auto", "serpapi", "serper"]).optional().describe("SERP provider (default: 'auto')."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        const result = await detectSerpFreshnessGaps(
          args.keywords,
          {
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
        );
        return asJsonContent(result);
      },
    );

    this.server.tool(
      "find_high_cpc_low_kd_keywords",
      "Find 'Golden Ratio' commercial opportunities: keywords that have high advertiser CPC bids and search volume, but low SEO Keyword Difficulty (KD <= 45). Calculates a Golden Ratio Opportunity Index = (Volume * CPC) / (KD + 1) to prioritize elite high-ROI money keywords.",
      {
        keywords: z
          .array(z.string())
          .min(1)
          .describe("Keywords to evaluate (e.g. ['best enterprise crm', 'cloud security posture management'])."),
        customerId: z
          .string()
          .optional()
          .describe("Google Ads customer ID to automatically pull live CPC and search volume data."),
        minSearchVolume: z.number().int().optional().describe("Minimum monthly search volume (default: 200)."),
        minCpc: z.number().optional().describe("Minimum top-of-page CPC bid in USD (default: $2.00)."),
        maxKd: z.number().int().optional().describe("Maximum Keyword Difficulty score (default: 45)."),
        country: z.string().optional().describe("Two-letter country code (default 'us')."),
        language: z.string().optional().describe("Two-letter language code (default 'en')."),
        provider: z.enum(["auto", "serpapi", "serper"]).optional().describe("SERP provider (default: 'auto')."),
        developerToken: z.string().optional().describe("Optional Google Ads developer token override."),
        loginCustomerId: z.string().optional().describe("Optional Google Ads login customer ID."),
        serpApiKey: z.string().optional().describe("Optional SerpApi key override."),
        serperApiKey: z.string().optional().describe("Optional Serper.dev key override."),
      },
      async (args) => {
        const serpConfig = this.getSerpConfig(args.serpApiKey, args.serperApiKey);
        let metricInputs: Array<{
          keyword: string;
          avgMonthlySearches: number;
          highTopOfPageBid?: number | string;
        }> = [];

        // If customerId is provided, attempt to fetch real Google Ads metrics
        if (args.customerId) {
          try {
            const token = await this.accessToken();
            const adsConfig = this.getGoogleAdsConfig(
              args.developerToken,
              args.loginCustomerId,
            );
            if (adsConfig.developerToken) {
              const adsData = await getKeywordHistoricalMetrics(
                {
                  token,
                  developerToken: adsConfig.developerToken,
                  loginCustomerId: adsConfig.loginCustomerId,
                  apiVersion: adsConfig.apiVersion,
                },
                {
                  customerId: args.customerId,
                  keywords: args.keywords,
                  language: args.language,
                },
              );
              if (Array.isArray(adsData.keywords)) {
                metricInputs = adsData.keywords.map((m) => ({
                  keyword: m.keyword,
                  avgMonthlySearches: m.avgMonthlySearches,
                  highTopOfPageBid: m.highTopOfPageBid,
                }));
              }
            }
          } catch {
            // Fall back to baseline if Google Ads call fails or is unconfigured
          }
        }

        // If no Ads metrics fetched, initialize baseline for each keyword
        if (metricInputs.length === 0) {
          metricInputs = args.keywords.map((k) => ({
            keyword: k,
            avgMonthlySearches: 500,
            highTopOfPageBid: "$5.00",
          }));
        }

        const result = await findHighCpcLowKdKeywords(
          metricInputs,
          {
            country: args.country,
            language: args.language,
            provider: args.provider,
            serpApiKey: serpConfig.serpApiKey,
            serperApiKey: serpConfig.serperApiKey,
          },
          serpConfig,
          args.minSearchVolume ?? 200,
          args.minCpc ?? 2.0,
          args.maxKd ?? 45,
        );

        return asJsonContent(result);
      },
    );

    // ── Microsoft Clarity Live Insights & Multi-Project Tools ───────────────

    const clarityDimensionSchema = z.enum([
      "Browser",
      "Device",
      "Country",
      "OS",
      "Source",
      "Medium",
      "Campaign",
      "Channel",
      "URL",
    ]);

    this.server.tool(
      "clarity_list_projects",
      "List all configured Microsoft Clarity project aliases (e.g. aiskyla, openrees, calorieinsight) and KV-stored projects. Use this first to see which websites have Clarity tracking available without exposing raw tokens.",
      {},
      async () => {
        const info = await listAllClarityProjects(
          this.env.CLARITY_PROJECT_TOKENS,
          this.env.CLARITY_API_TOKEN,
          this.env.OAUTH_KV,
        );
        return asJsonContent({
          projects: info.allProjects,
          configuredInEnv: info.envProjects,
          savedInKv: info.kvProjects,
          hasDefaultToken: info.hasDefaultToken,
          help: "To query a project, pass its name to 'project'. You can also pass 'apiToken' directly for unlisted projects or use 'clarity_save_project' to add more.",
        });
      },
    );

    this.server.tool(
      "clarity_get_live_insights",
      "Retrieve live dashboard metrics, traffic, and behavioral interaction signals (Rage Clicks, Dead Clicks, Excessive Scrolling, Quick Backs) from Microsoft Clarity. Supports multi-project token resolution. NOTE: Microsoft Clarity enforces a strict limit of 10 requests per project per day.",
      {
        project: z
          .string()
          .optional()
          .describe("Project name or domain alias (e.g. 'aiskyla', 'openrees', 'calorieinsight'). Use clarity_list_projects to view aliases."),
        apiToken: z
          .string()
          .optional()
          .describe("Optional direct Clarity API token override for this request."),
        numOfDays: z
          .enum(["1", "2", "3"])
          .default("1")
          .describe("Timeframe: '1' = last 24h, '2' = last 48h, '3' = last 72h (default: '1')."),
        dimension1: clarityDimensionSchema
          .optional()
          .describe("Primary breakdown dimension (e.g. 'Device', 'URL', 'Source', 'Country')."),
        dimension2: clarityDimensionSchema
          .optional()
          .describe("Secondary breakdown dimension."),
        dimension3: clarityDimensionSchema
          .optional()
          .describe("Tertiary breakdown dimension."),
        metricFilter: z
          .string()
          .optional()
          .describe("Optional filter by metric name (e.g. 'Traffic', 'Rage Click Count', 'Dead Click Count', 'Scroll Depth')."),
      },
      async (args) => {
        const { token, resolvedProject, source } = await resolveClarityToken(
          args.project,
          args.apiToken,
          this.env.CLARITY_PROJECT_TOKENS,
          this.env.CLARITY_API_TOKEN,
          this.env.OAUTH_KV,
        );

        const data = await fetchClarityLiveInsights(token, {
          numOfDays: Number(args.numOfDays) as 1 | 2 | 3,
          dimension1: args.dimension1,
          dimension2: args.dimension2,
          dimension3: args.dimension3,
        });

        let filtered = data;
        if (args.metricFilter) {
          const filterLower = args.metricFilter.toLowerCase();
          filtered = data.filter((m) =>
            m.metricName.toLowerCase().includes(filterLower),
          );
        }

        return asJsonContent({
          project: resolvedProject,
          resolvedFrom: source,
          numOfDays: args.numOfDays,
          dimensions: [args.dimension1, args.dimension2, args.dimension3].filter(Boolean),
          metricCount: filtered.length,
          metrics: filtered,
        });
      },
    );

    this.server.tool(
      "clarity_get_ux_friction_summary",
      "Analyze user frustration and UX friction on a website using Microsoft Clarity live data. Computes a Friction Score (0-100), summarizes Rage Clicks, Dead Clicks, Excessive Scrolling, and Quick Backs, and pinpoints top problem dimensions/URLs.",
      {
        project: z
          .string()
          .optional()
          .describe("Project name or domain alias (e.g. 'aiskyla', 'openrees', 'calorieinsight')."),
        apiToken: z
          .string()
          .optional()
          .describe("Optional direct Clarity API token override."),
        numOfDays: z
          .enum(["1", "2", "3"])
          .default("1")
          .describe("Timeframe: '1' = last 24h, '2' = last 48h, '3' = last 72h (default: '1')."),
        dimension: clarityDimensionSchema
          .default("URL")
          .describe("Dimension to pinpoint friction areas by (default: 'URL', or 'Device', 'Browser')."),
      },
      async (args) => {
        const { token, resolvedProject, source } = await resolveClarityToken(
          args.project,
          args.apiToken,
          this.env.CLARITY_PROJECT_TOKENS,
          this.env.CLARITY_API_TOKEN,
          this.env.OAUTH_KV,
        );

        const data = await fetchClarityLiveInsights(token, {
          numOfDays: Number(args.numOfDays) as 1 | 2 | 3,
          dimension1: args.dimension,
        });

        const frictionAnalysis = summarizeUxFriction(data);

        return asJsonContent({
          project: resolvedProject,
          resolvedFrom: source,
          numOfDays: args.numOfDays,
          dimension: args.dimension,
          ...frictionAnalysis,
        });
      },
    );

    this.server.tool(
      "clarity_save_project",
      "Dynamically save or update a Microsoft Clarity project API token in Cloudflare KV. This allows adding new projects on-the-fly without modifying secrets or redeploying.",
      {
        projectName: z
          .string()
          .describe("Project name or domain identifier (e.g. 'my-new-site' or 'client-site.com')."),
        apiToken: z
          .string()
          .describe("The project JWT API token from Microsoft Clarity Settings -> Data Export."),
      },
      async (args) => {
        await saveProjectTokenToKV(this.env.OAUTH_KV, args.projectName, args.apiToken);
        return asJsonContent({
          status: "success",
          savedProject: args.projectName.toLowerCase().trim(),
          message: `Clarity API token for '${args.projectName}' successfully stored in Cloudflare KV. You can now query it using project: '${args.projectName}'.`,
        });
      },
    );

    // ── DataForSEO Tools: Backlinks, Keyword Difficulty & SERP Intelligence ─

    this.server.tool(
      "dataforseo_backlinks_summary",
      "Fetch domain or URL backlink overview from DataForSEO v3: domain authority rank (0-1000), 0-100 authority score, total backlinks count, referring domains, referring IPs, broken links/pages, dofollow vs nofollow breakdown, and top referring TLDs.",
      {
        target: z
          .string()
          .describe("Target domain or URL (e.g. 'aiskyla.com' or 'https://example.com/blog/article')."),
        includeSubdomains: z
          .boolean()
          .default(true)
          .describe("Include backlinks pointing to all subdomains (default: true)."),
        internalListLimit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(10)
          .describe("Number of internal links to analyze for anchor context (default: 10)."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key (Base64 login:password) override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const data = await getDataForSeoBacklinksSummary(
          args.target,
          {
            includeSubdomains: args.includeSubdomains,
            internalListLimit: args.internalListLimit,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "dataforseo_backlinks_list",
      "List individual live backlinks pointing to a target domain or URL from DataForSEO v3 with anchor text, source URL, target URL, dofollow status, authority rank, page/domain rank, spam score, and status.",
      {
        target: z
          .string()
          .describe("Target domain or URL (e.g. 'aiskyla.com')."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe("Number of backlinks to return (default: 30, max: 100)."),
        mode: z
          .enum(["as_is", "one_per_domain", "one_per_anchor"])
          .default("as_is")
          .describe("Backlink aggregation mode (default: 'as_is')."),
        orderBy: z
          .string()
          .default("rank,desc")
          .describe("Sort order field and direction (default: 'rank,desc')."),
        includeSubdomains: z
          .boolean()
          .default(true)
          .describe("Include backlinks to subdomains (default: true)."),
        dofollowOnly: z
          .boolean()
          .default(false)
          .describe("If true, filters results to return only dofollow backlinks."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const data = await getDataForSeoBacklinksList(
          args.target,
          {
            limit: args.limit,
            mode: args.mode,
            orderBy: args.orderBy,
            includeSubdomains: args.includeSubdomains,
            dofollowOnly: args.dofollowOnly,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "dataforseo_referring_domains",
      "List referring domains pointing to a target domain or URL from DataForSEO v3 with domain authority rank, backlinks count, referring pages, broken links count, and spam scores.",
      {
        target: z
          .string()
          .describe("Target domain or URL (e.g. 'aiskyla.com')."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe("Number of referring domains to return (default: 30, max: 100)."),
        orderBy: z
          .string()
          .default("rank,desc")
          .describe("Sort order (default: 'rank,desc')."),
        includeSubdomains: z
          .boolean()
          .default(true)
          .describe("Include subdomains of the target (default: true)."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const data = await getDataForSeoReferringDomains(
          args.target,
          {
            limit: args.limit,
            orderBy: args.orderBy,
            includeSubdomains: args.includeSubdomains,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "dataforseo_keyword_difficulty",
      "Check official DataForSEO 0–100 Keyword Difficulty (KD) scores, difficulty tier ('Very Easy' to 'Very Hard'), and ranking effort estimates for single or bulk keywords.",
      {
        keywords: z
          .union([z.string(), z.array(z.string())])
          .describe("Single keyword or list of keywords to evaluate (e.g. ['seo tools', 'keyword difficulty'] or 'best ai gifting platform')."),
        locationName: z
          .string()
          .default("United States")
          .describe("Geographic location name (default: 'United States')."),
        languageName: z
          .string()
          .default("English")
          .describe("Search language name (default: 'English')."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const kwList = Array.isArray(args.keywords) ? args.keywords : [args.keywords];
        const data = await getDataForSeoKeywordDifficulty(
          kwList,
          {
            locationName: args.locationName,
            languageName: args.languageName,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "dataforseo_serp_who_is_ranking",
      "Query live Google organic SERP via DataForSEO v3 to see who is ranking for any keyword: top ranking domains/URLs, titles, snippets, plus detection of AI Overviews, Featured Snippets, People Also Ask, and Reddit/Forum discussions.",
      {
        keyword: z
          .string()
          .describe("Search query to inspect live Google rankings and competitors for (e.g. 'best ai gifting platform')."),
        locationName: z
          .string()
          .default("United States")
          .describe("Location name for Google search (default: 'United States')."),
        languageName: z
          .string()
          .default("English")
          .describe("Language for Google search (default: 'English')."),
        depth: z
          .number()
          .int()
          .min(10)
          .max(100)
          .default(20)
          .describe("Depth of SERP results to inspect (default: 20, max: 100)."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const data = await getDataForSeoSerpWhoIsRanking(
          args.keyword,
          {
            locationName: args.locationName,
            languageName: args.languageName,
            depth: args.depth,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "dataforseo_serp_competitors",
      "Identify top competitor domains ranking across one or multiple search keywords in Google via DataForSEO v3, including average ranking position, rating, visibility, and estimated traffic volume (ETV).",
      {
        keywords: z
          .union([z.string(), z.array(z.string())])
          .describe("Keyword or list of keywords to identify top competitor domains for."),
        locationName: z
          .string()
          .default("United States")
          .describe("Location name (default: 'United States')."),
        languageName: z
          .string()
          .default("English")
          .describe("Language (default: 'English')."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const kwList = Array.isArray(args.keywords) ? args.keywords : [args.keywords];
        const data = await getDataForSeoSerpCompetitors(
          kwList,
          {
            locationName: args.locationName,
            languageName: args.languageName,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "dataforseo_domain_ranked_keywords",
      "Discover organic Google search keywords that any target domain or competitor ranks for, including keyword, rank position, ranking URL, search volume, CPC, keyword difficulty (KD), and estimated traffic.",
      {
        target: z
          .string()
          .describe("Target domain or URL to uncover all ranked keywords for (e.g. 'aiskyla.com' or 'semrush.com')."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Max keywords to return (default: 50, max: 100)."),
        locationName: z
          .string()
          .default("United States")
          .describe("Location name (default: 'United States')."),
        languageName: z
          .string()
          .default("English")
          .describe("Language (default: 'English')."),
        orderBy: z
          .string()
          .default("ranked_serp_element.serp_item.rank_group,asc")
          .describe("Sort order (default: 'ranked_serp_element.serp_item.rank_group,asc')."),
        login: z
          .string()
          .optional()
          .describe("Optional DataForSEO login email override."),
        password: z
          .string()
          .optional()
          .describe("Optional DataForSEO password override."),
        apiKey: z
          .string()
          .optional()
          .describe("Optional DataForSEO API key override."),
      },
      async (args) => {
        const auth = this.getDataForSeoAuth(args.login, args.password, args.apiKey);
        const data = await getDataForSeoRankedKeywords(
          args.target,
          {
            limit: args.limit,
            locationName: args.locationName,
            languageName: args.languageName,
            orderBy: args.orderBy,
          },
          auth,
        );
        return asJsonContent(data);
      },
    );
     this.server.tool(
      "write_seo_content",
      "Generate SEO content for BodyNutrition using the verified SEO Radar brief. Use only for INTEGRARE or RISCRIVERE decisions. The Writer does not publish content.",
      {
        language: z.string(),
        market: z.string(),
        model: z.string().optional(),

        pageType: z.enum([
          "category",
          "product",
          "manufacturer",
          "magazine",
          "landing",
        ]),

        pageId: z.string().optional(),
        url: z.string().optional(),

        decision: z.enum([
          "INTEGRARE",
          "RISCRIVERE",
        ]),

        searchIntent: z.string(),
        primaryKeyword: z.string(),

        secondaryKeywords: z
          .array(z.string())
          .optional(),

        verifiedCatalogFacts: z
          .array(z.string())
          .optional(),

        verifiedInternalLinks: z
          .array(
            z.object({
              label: z.string(),
              url: z.string(),
              type: z
                .enum([
                  "shop_category",
                  "magazine_category",
                  "magazine_article",
                  "product",
                  "manufacturer",
                  "landing",
                  "other",
                ])
                .optional(),
              context: z.string().optional(),
            }),
          )
          .optional(),

        existingContent: z.string().optional(),

        contentToPreserve: z
          .array(z.string())
          .optional(),

        seoEvidence: z
          .array(z.string())
          .optional(),

        instructions: z.string().optional(),

        priorFingerprints: z
          .array(
            z.object({
              entity_type: z
                .enum([
                  "category",
                  "product",
                  "manufacturer",
                  "magazine",
                  "landing",
                ])
                .optional(),
              entity_id: z.string().optional(),
              language: z.string().optional(),
              market: z.string().optional(),
              cluster: z.string().optional(),
              opening: z.string(),
              h2_structure: z.array(z.string()),
              editorial_angle: z.string(),
              cta_patterns: z.array(z.string()),
              faq_topics: z.array(z.string()),
              structure_type: z.string(),
              catalog_evidence_used: z.array(z.string()),
              serp_gap_used: z.string(),
              writer_model: z.string().optional(),
              published_at: z.string().optional(),
            }),
          )
          .optional(),

        cluster: z.string().optional(),
        proposedEditorialAngle: z.string().optional(),
        serpGap: z.string().optional(),
        catalogEvidence: z
          .array(z.string())
          .optional(),
      },

      async (args) => {
        try {
          const apiKey =
            this.env.ANTHROPIC_API_KEY?.trim();

          if (!apiKey) {
            throw new Error(
              "ANTHROPIC_API_KEY is not configured.",
            );
          }
          const { model, ...writerInput } = args;
          const result =
          await writeSeoContent(
          apiKey,
          writerInput,
          model,
        );

          return asJsonContent(result);
        } catch (error) {
          return asJsonContent({
            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        }
      },
    );
  }

  private getDataForSeoAuth(
    loginArg?: string,
    passwordArg?: string,
    apiKeyArg?: string,
  ): string {
    const login = cleanSecret(loginArg) || cleanSecret(this.env.DATAFORSEO_LOGIN) || undefined;
    const password = cleanSecret(passwordArg) || cleanSecret(this.env.DATAFORSEO_PASSWORD) || undefined;
    const apiKey = cleanSecret(apiKeyArg) || cleanSecret(this.env.DATAFORSEO_API_KEY) || undefined;

    return resolveDataForSeoAuth(login, password, apiKey);
  }

  private getSerpConfig(
    serpApiKeyArg?: string,
    serperApiKeyArg?: string,
  ) {
    const serpApiKey =
      cleanSecret(serpApiKeyArg || this.env.SERPAPI_API_KEY) || undefined;
    const serperApiKey =
      cleanSecret(serperApiKeyArg || this.env.SERPER_API_KEY) || undefined;
    return { serpApiKey, serperApiKey };
  }

  private getGoogleAdsConfig(
    developerTokenArg?: string,
    loginCustomerIdArg?: string,
    apiVersionArg?: string,
  ) {
    const developerToken = cleanSecret(
      developerTokenArg || this.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    );
    const loginCustomerId =
      cleanSecret(
        loginCustomerIdArg || this.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      ) || undefined;
    const apiVersion =
      cleanSecret(
        apiVersionArg || this.env.GOOGLE_ADS_API_VERSION,
      ) || undefined;
    return { developerToken, loginCustomerId, apiVersion };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// API handler — only reached after OAuthProvider validated the access token.
// ────────────────────────────────────────────────────────────────────────────

const apiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return GSCMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return GSCMCP.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ────────────────────────────────────────────────────────────────────────────
// Default handler — public surface.
//
// /              landing
// /health        liveness probe
// /authorize     bearer-key gate, then redirect to Google
// /oauth/google/callback  Google OAuth landing, exchanges code, completes MCP grant
// ────────────────────────────────────────────────────────────────────────────

const LANDING = `gsc-mcp-connector
Self-hosted Google Search Console MCP server on Cloudflare Workers.

Endpoints:
  POST /mcp        Streamable HTTP MCP transport (requires OAuth access token)
  GET  /sse        Server-Sent Events MCP transport (legacy clients)
  GET  /authorize  OAuth 2.1 login UI (bearer + Google)

OAuth metadata:
  /.well-known/oauth-authorization-server

Source: https://github.com/JuJu78/gsc-mcp-connector
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loginPage(opts: {
  oauthState: string;
  clientName: string;
  clientId: string;
  scope: string[];
  error?: string;
}): string {
  const errorBlock = opts.error
    ? `<div class="error">${escapeHtml(opts.error)}</div>`
    : "";

  const scopeBlock = opts.scope.length
    ? `<p class="scope">Requested MCP scopes: <code>${escapeHtml(opts.scope.join(" "))}</code></p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>gsc-mcp-connector — Authorize</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  body { max-width: 480px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .sub { color: #666; font-size: .9rem; margin-top: 0; }
  .client { background: rgba(127,127,127,.08); border: 1px solid rgba(127,127,127,.2); border-radius: 6px; padding: 1rem; margin: 1.5rem 0; }
  .client b { display: block; font-size: 1.05rem; }
  .scope { font-size: .85rem; color: #666; margin: .5rem 0 0; }
  label { display: block; font-weight: 600; margin: 1rem 0 .25rem; }
  input[type=password] { width: 100%; padding: .65rem .8rem; font-size: 1rem; border-radius: 6px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, monospace; }
  button { margin-top: 1.25rem; width: 100%; padding: .8rem; font-size: 1rem; font-weight: 600; border-radius: 6px; border: 0; background: #2563eb; color: white; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .error { background: #fee2e2; color: #991b1b; padding: .65rem .8rem; border-radius: 6px; font-size: .9rem; margin: 1rem 0; }
  .hint { font-size: .8rem; color: #888; margin-top: 1rem; }
  code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .85em; background: rgba(127,127,127,.12); padding: 1px 5px; border-radius: 3px; }
  .steps { font-size: .85rem; color: #666; margin: 1rem 0 0; padding-left: 1.2rem; }
  .steps li { margin: .25rem 0; }
</style>
</head>
<body>
<h1>Authorize MCP client</h1>
<p class="sub">A client wants to use this connector to query your Google Search Console, Analytics, and Google Ads data.</p>

<div class="client">
  <b>${escapeHtml(opts.clientName || "Unknown client")}</b>
  <span class="scope"><code>client_id: ${escapeHtml(opts.clientId)}</code></span>
  ${scopeBlock}
</div>

${errorBlock}

<form method="POST" action="/authorize" autocomplete="off">
  <input type="hidden" name="oauth_state" value="${escapeHtml(opts.oauthState)}">
  <label for="access_key">Connector access key</label>
  <input type="password" id="access_key" name="access_key" required autofocus
         placeholder="MCP_BEARER_TOKEN">
  <button type="submit">Continue with Google →</button>
</form>

<ol class="steps">
  <li>Paste the access key set at deploy time (<code>MCP_BEARER_TOKEN</code>).</li>
  <li>You will be redirected to Google to grant access.</li>
  <li>After granting, you return to ${escapeHtml(opts.clientName || "the client")} authorized.</li>
</ol>
</body>
</html>`;
}

// We pack two pieces into Google's `state` param:
//   - the original MCP AuthRequest (so we can complete it on Google callback)
//   - a random nonce to bind the redirect to this instance
function packGoogleState(oauthReq: AuthRequest): string {
  return btoa(
    JSON.stringify({
      v: 1,
      req: oauthReq,
      nonce: crypto.randomUUID(),
    }),
  );
}

interface PackedState {
  v: number;
  req: AuthRequest;
  nonce: string;
}

function unpackGoogleState(state: string): PackedState {
  const decoded = JSON.parse(atob(state)) as PackedState;
  if (decoded.v !== 1 || !decoded.req || !decoded.nonce) {
    throw new Error("Invalid state");
  }
  return decoded;
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(LANDING, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: { "content-type": "text/plain" },
      });
    }

    // ── /authorize GET: render bearer-key form ───────────────────────────
    if (url.pathname === "/authorize" && request.method === "GET") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      let clientInfo: ClientInfo | null = null;
      try {
        clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
      } catch {
        clientInfo = null;
      }

      const html = loginPage({
        oauthState: btoa(JSON.stringify(oauthReqInfo)),
        clientName: clientInfo?.clientName || oauthReqInfo.clientId,
        clientId: oauthReqInfo.clientId,
        scope: oauthReqInfo.scope ?? [],
      });

      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ── /authorize POST: validate bearer, redirect to Google ─────────────
    if (url.pathname === "/authorize" && request.method === "POST") {
      const formData = await request.formData();
      const submittedKey = formData.get("access_key");
      const oauthStateRaw = formData.get("oauth_state");

      if (typeof oauthStateRaw !== "string" || !oauthStateRaw) {
        return new Response("Missing oauth_state", { status: 400 });
      }

      let oauthReqInfo: AuthRequest;
      try {
        oauthReqInfo = JSON.parse(atob(oauthStateRaw)) as AuthRequest;
      } catch {
        return new Response("Invalid oauth_state", { status: 400 });
      }

      const expected = cleanSecret(env.MCP_BEARER_TOKEN);
      const provided = cleanSecret(submittedKey);

      if (!expected || !provided || provided !== expected) {
        const html = loginPage({
          oauthState: oauthStateRaw,
          clientName: oauthReqInfo.clientId,
          clientId: oauthReqInfo.clientId,
          scope: oauthReqInfo.scope ?? [],
          error: "Invalid access key. Try again.",
        });
        return new Response(html, {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      // Bearer OK → redirect to Google.
      const googleConfig = googleConfigFromEnv(env, request);
      if (!googleConfig.clientId || !googleConfig.clientSecret) {
        return new Response(
          "Server misconfigured: GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET is missing.",
          { status: 500 },
        );
      }

      const googleState = packGoogleState(oauthReqInfo);
      const googleAuthorizeUrl = buildAuthorizeUrl(googleConfig, googleState);
      return Response.redirect(googleAuthorizeUrl, 302);
    }

    // ── /oauth/google/callback: exchange code, complete MCP grant ────────
    if (url.pathname === "/oauth/google/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const googleError = url.searchParams.get("error");

      if (googleError) {
        return new Response(
          `Google declined the authorization: ${googleError}. Close this tab and retry from the client.`,
          { status: 400, headers: { "content-type": "text/plain" } },
        );
      }

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      let unpacked: PackedState;
      try {
        unpacked = unpackGoogleState(state);
      } catch {
        return new Response("Invalid state", { status: 400 });
      }

      const googleConfig = googleConfigFromEnv(env, request);
      let tokens;
      try {
        tokens = await exchangeCode(googleConfig, code);
      } catch (e) {
        return new Response(
          `Google token exchange failed: ${(e as Error).message}`,
          { status: 502, headers: { "content-type": "text/plain" } },
        );
      }

      const props: GrantProps = {
        googleRefreshToken: tokens.refreshToken,
        grantedAt: Date.now(),
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: unpacked.req,
        userId: "operator",
        metadata: { provider: "google-oauth", scope: tokens.scope },
        scope: unpacked.req.scope ?? ["gsc:read", "ga4:read", "googleads:read"],
        props,
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ────────────────────────────────────────────────────────────────────────────

export default new OAuthProvider({
  apiRoute: ["/mcp", "/sse"],
  apiHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["gsc:read", "ga4:read", "googleads:read"],
});
