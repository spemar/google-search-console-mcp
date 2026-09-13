/**
 * DataForSEO v3 REST API Client for Backlinks, Keyword Difficulty & SERP Intelligence.
 * Official Documentation: https://docs.dataforseo.com/v3/
 */

const DATAFORSEO_API_BASE = "https://api.dataforseo.com/v3";

function toBase64(str: string): string {
  return btoa(str);
}


/**
 * Format Basic Authentication header from credentials or environment variables.
 */
export function resolveDataForSeoAuth(
  login?: string,
  password?: string,
  apiKey?: string,
  env?: {
    DATAFORSEO_LOGIN?: string;
    DATAFORSEO_PASSWORD?: string;
    DATAFORSEO_API_KEY?: string;
  },
): string {
  // 1. Direct explicit apiKey argument or env
  const key = (apiKey || env?.DATAFORSEO_API_KEY || "").trim();
  if (key) {
    if (key.startsWith("Basic ")) return key;
    if (key.includes(":")) {
      return `Basic ${toBase64(key)}`;
    }
    return `Basic ${key}`;
  }

  // 2. Direct login & password argument or env
  const l = (login || env?.DATAFORSEO_LOGIN || "").trim();
  const p = (password || env?.DATAFORSEO_PASSWORD || "").trim();
  if (l && p) {
    return `Basic ${toBase64(`${l}:${p}`)}`;
  }

  throw new Error(
    "DataForSEO credentials missing. Provide login & password or apiKey in tool parameters, or set DATAFORSEO_LOGIN & DATAFORSEO_PASSWORD in .dev.vars or environment secrets.",
  );
}

export interface DataForSeoTaskResponse<T = unknown> {
  version: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks?: Array<{
    id: string;
    status_code: number;
    status_message: string;
    time: string;
    cost: number;
    result_count: number;
    path: string[];
    data: Record<string, unknown>;
    result?: T[];
  }>;
}

/**
 * Generic caller for DataForSEO POST endpoints with detailed error diagnostics.
 */
async function callDataForSeo<T = unknown>(
  endpointPath: string,
  payload: unknown,
  authHeader: string,
): Promise<T[]> {
  const url = `${DATAFORSEO_API_BASE}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorDetails = "";
    try {
      const errJson = (await response.json()) as DataForSeoTaskResponse;
      if (errJson.status_code === 40104) {
        throw new Error(
          "DataForSEO Account Verification Required (Code 40104): Please verify your account at https://app.dataforseo.com/ before running queries.",
        );
      }
      errorDetails = errJson.status_message || JSON.stringify(errJson);
    } catch (e) {
      if (e instanceof Error && e.message.includes("40104")) throw e;
      errorDetails = await response.text();
    }
    throw new Error(
      `DataForSEO HTTP ${response.status} ${response.statusText}: ${errorDetails}`,
    );
  }

  const json = (await response.json()) as DataForSeoTaskResponse<T>;

  if (json.status_code === 40104) {
    throw new Error(
      "DataForSEO Account Verification Required (Code 40104): Please verify your account at https://app.dataforseo.com/ before running queries.",
    );
  }

  if (json.status_code !== 20000) {
    throw new Error(
      `DataForSEO API error [${json.status_code}]: ${json.status_message}`,
    );
  }

  const task = json.tasks?.[0];
  if (!task) {
    throw new Error("DataForSEO returned no tasks in response.");
  }

  if (task.status_code !== 20000) {
    throw new Error(
      `DataForSEO task error [${task.status_code}]: ${task.status_message}`,
    );
  }

  return task.result || [];
}

function cleanTarget(target: string): string {
  let t = target.trim();
  t = t.replace(/^https?:\/\//i, "");
  t = t.replace(/\/+$/, "");
  return t;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Backlinks Summary
// ────────────────────────────────────────────────────────────────────────────

export interface BacklinksSummaryOptions {
  includeSubdomains?: boolean;
  internalListLimit?: number;
}

export interface BacklinksSummaryResult {
  target: string;
  rank: number;
  authorityScore: number;
  totalBacklinks: number;
  referringDomains: number;
  referringMainDomains: number;
  referringPages: number;
  referringIps: number;
  referringSubnets: number;
  brokenBacklinks: number;
  brokenPages: number;
  spamScore: number;
  dofollowBreakdown: {
    referringDomainsDofollow: number;
    referringDomainsNofollow: number;
    referringPagesDofollow: number;
    referringPagesNofollow: number;
  };
  backlinkTypes: Record<string, number>;
  topTlds: Record<string, number>;
  attributes: Record<string, number>;
  platformTypes: Record<string, number>;
  countries: Record<string, number>;
  firstSeen: string | null;
}

export async function getDataForSeoBacklinksSummary(
  target: string,
  options: BacklinksSummaryOptions = {},
  authHeader: string,
): Promise<BacklinksSummaryResult> {
  const cleaned = cleanTarget(target);
  const payload = [
    {
      target: cleaned,
      include_subdomains: options.includeSubdomains ?? true,
      internal_list_limit: options.internalListLimit ?? 10,
    },
  ];

  const results = await callDataForSeo<Record<string, any>>(
    "/backlinks/summary/live",
    payload,
    authHeader,
  );

  const res = results[0];
  if (!res) {
    throw new Error(`No backlink summary data found for target: '${target}'.`);
  }

  const rank = typeof res.rank === "number" ? res.rank : 0;
  const authorityScore = Math.round(rank / 10);
  const refDomains = res.referring_domains || 0;
  const refDomainsNofollow = res.referring_domains_nofollow || 0;
  const refPages = res.referring_pages || 0;
  const refPagesNofollow = res.referring_pages_nofollow || 0;

  return {
    target: res.target || cleaned,
    rank,
    authorityScore,
    totalBacklinks: res.backlinks || 0,
    referringDomains: refDomains,
    referringMainDomains: res.referring_main_domains || 0,
    referringPages: refPages,
    referringIps: res.referring_ips || 0,
    referringSubnets: res.referring_subnets || 0,
    brokenBacklinks: res.broken_backlinks || 0,
    brokenPages: res.broken_pages || 0,
    spamScore:
      res.backlinks_spam_score ?? res.info?.target_spam_score ?? 0,
    dofollowBreakdown: {
      referringDomainsDofollow: Math.max(0, refDomains - refDomainsNofollow),
      referringDomainsNofollow: refDomainsNofollow,
      referringPagesDofollow: Math.max(0, refPages - refPagesNofollow),
      referringPagesNofollow: refPagesNofollow,
    },
    backlinkTypes: res.referring_links_types || {},
    topTlds: res.referring_links_tld || {},
    attributes: res.referring_links_attributes || {},
    platformTypes: res.referring_links_platform_types || {},
    countries: res.referring_links_countries || {},
    firstSeen: res.first_seen || null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Backlinks List
// ────────────────────────────────────────────────────────────────────────────

export interface BacklinksListOptions {
  limit?: number;
  mode?: "as_is" | "one_per_domain" | "one_per_anchor";
  orderBy?: string;
  includeSubdomains?: boolean;
  dofollowOnly?: boolean;
}

export interface BacklinkItem {
  sourceDomain: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  itemType: string;
  isDofollow: boolean;
  backlinkRank: number;
  domainFromRank: number;
  pageFromRank: number;
  spamScore: number;
  isBroken: boolean;
  isNew: boolean;
  isLost: boolean;
  pageFromTitle?: string;
  firstSeen?: string;
  lastSeen?: string;
  semanticLocation?: string;
}

export interface BacklinksListResult {
  target: string;
  totalReturned: number;
  items: BacklinkItem[];
}

export async function getDataForSeoBacklinksList(
  target: string,
  options: BacklinksListOptions = {},
  authHeader: string,
): Promise<BacklinksListResult> {
  const cleaned = cleanTarget(target);
  const taskPayload: Record<string, any> = {
    target: cleaned,
    limit: options.limit ?? 30,
    mode: options.mode ?? "as_is",
    order_by: options.orderBy ? [options.orderBy] : ["rank,desc"],
    include_subdomains: options.includeSubdomains ?? true,
  };

  if (options.dofollowOnly) {
    taskPayload.filters = [["dofollow", "=", true]];
  }

  const results = await callDataForSeo<Record<string, any>>(
    "/backlinks/backlinks/live",
    [taskPayload],
    authHeader,
  );

  const res = results[0];
  const rawItems: any[] = (res && Array.isArray(res.items)) ? res.items : [];

  const items: BacklinkItem[] = rawItems.map((b) => ({
    sourceDomain: b.domain_from || "",
    sourceUrl: b.url_from || "",
    targetUrl: b.url_to || "",
    anchorText:
      b.anchor ||
      (b.item_type === "image" ? "[Image Link]" : "[Empty / No Text]"),
    itemType: b.item_type || "anchor",
    isDofollow: Boolean(b.dofollow),
    backlinkRank: typeof b.rank === "number" ? b.rank : 0,
    domainFromRank: typeof b.domain_from_rank === "number" ? b.domain_from_rank : 0,
    pageFromRank: typeof b.page_from_rank === "number" ? b.page_from_rank : 0,
    spamScore: typeof b.backlink_spam_score === "number" ? b.backlink_spam_score : 0,
    isBroken: Boolean(b.is_broken),
    isNew: Boolean(b.is_new),
    isLost: Boolean(b.is_lost),
    pageFromTitle: b.page_from_title || undefined,
    firstSeen: b.first_seen || undefined,
    lastSeen: b.last_seen || undefined,
    semanticLocation: b.semantic_location || undefined,
  }));

  return {
    target: cleaned,
    totalReturned: items.length,
    items,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Referring Domains
// ────────────────────────────────────────────────────────────────────────────

export interface ReferringDomainsOptions {
  limit?: number;
  orderBy?: string;
  includeSubdomains?: boolean;
}

export interface ReferringDomainItem {
  domain: string;
  rank: number;
  authorityScore: number;
  backlinksCount: number;
  referringPages: number;
  brokenBacklinks: number;
  spamScore: number;
  firstSeen?: string;
  topTlds?: Record<string, number>;
}

export interface ReferringDomainsResult {
  target: string;
  totalReturned: number;
  items: ReferringDomainItem[];
}

export async function getDataForSeoReferringDomains(
  target: string,
  options: ReferringDomainsOptions = {},
  authHeader: string,
): Promise<ReferringDomainsResult> {
  const cleaned = cleanTarget(target);
  const taskPayload = {
    target: cleaned,
    limit: options.limit ?? 30,
    order_by: options.orderBy ? [options.orderBy] : ["rank,desc"],
    include_subdomains: options.includeSubdomains ?? true,
  };

  const results = await callDataForSeo<Record<string, any>>(
    "/backlinks/referring_domains/live",
    [taskPayload],
    authHeader,
  );

  const res = results[0];
  const rawItems: any[] = (res && Array.isArray(res.items)) ? res.items : [];

  const items: ReferringDomainItem[] = rawItems.map((d) => {
    const rank = typeof d.rank === "number" ? d.rank : 0;
    return {
      domain: d.domain || "",
      rank,
      authorityScore: Math.round(rank / 10),
      backlinksCount: d.backlinks || 0,
      referringPages: d.referring_pages || 0,
      brokenBacklinks: d.broken_backlinks || 0,
      spamScore: typeof d.backlinks_spam_score === "number" ? d.backlinks_spam_score : 0,
      firstSeen: d.first_seen || undefined,
      topTlds: d.referring_links_tld || undefined,
    };
  });

  return {
    target: cleaned,
    totalReturned: items.length,
    items,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Keyword Difficulty (Bulk / Single)
// ────────────────────────────────────────────────────────────────────────────

export interface KeywordDifficultyOptions {
  locationName?: string;
  locationCode?: number;
  languageName?: string;
  languageCode?: string;
}

export interface KeywordDifficultyItem {
  keyword: string;
  keywordDifficulty: number;
  tier: "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard";
  description: string;
  rankingEffort: string;
}

export interface KeywordDifficultyResult {
  location: string;
  language: string;
  count: number;
  averageDifficulty: number;
  items: KeywordDifficultyItem[];
}

export function getDifficultyTier(kd: number): {
  tier: "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard";
  description: string;
  rankingEffort: string;
} {
  if (kd <= 20) {
    return {
      tier: "Very Easy",
      description: "Low competition. Brand new sites can rank with well-structured, relevant content.",
      rankingEffort: "Fast ranking possible without extensive backlinks.",
    };
  }
  if (kd <= 40) {
    return {
      tier: "Easy",
      description: "Moderate competition. Few backlinks and quality topic coverage needed.",
      rankingEffort: "Achievable within 1-3 months with good on-page SEO.",
    };
  }
  if (kd <= 60) {
    return {
      tier: "Medium",
      description: "Competitive keyword. Decent domain authority and multiple quality referring domains required.",
      rankingEffort: "Requires solid backlink campaign and comprehensive content.",
    };
  }
  if (kd <= 80) {
    return {
      tier: "Hard",
      description: "High competition. Dominated by high-DR established industry authorities.",
      rankingEffort: "Significant link building and established domain trust required.",
    };
  }
  return {
    tier: "Very Hard",
    description: "Extremely competitive. Heavyweights (Wikipedia, Forbes, enterprise sites) dominate.",
    rankingEffort: "Massive brand authority and dozens/hundreds of high-authority links needed.",
  };
}

export async function getDataForSeoKeywordDifficulty(
  keywords: string[],
  options: KeywordDifficultyOptions = {},
  authHeader: string,
): Promise<KeywordDifficultyResult> {
  const cleanKeywords = keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (cleanKeywords.length === 0) {
    throw new Error("No valid keywords provided for keyword difficulty check.");
  }

  const taskPayload: Record<string, any> = {
    keywords: cleanKeywords,
    location_name: options.locationName || "United States",
    language_name: options.languageName || "English",
  };
  if (options.locationCode) taskPayload.location_code = options.locationCode;
  if (options.languageCode) taskPayload.language_code = options.languageCode;

  const results = await callDataForSeo<Record<string, any>>(
    "/dataforseo_labs/google/bulk_keyword_difficulty/live",
    [taskPayload],
    authHeader,
  );

  const res = results[0];
  const rawItems: any[] = (res && Array.isArray(res.items)) ? res.items : [];

  let totalKd = 0;
  const items: KeywordDifficultyItem[] = rawItems.map((k) => {
    const kd = typeof k.keyword_difficulty === "number" ? k.keyword_difficulty : 0;
    totalKd += kd;
    const tierInfo = getDifficultyTier(kd);
    return {
      keyword: k.keyword || "",
      keywordDifficulty: kd,
      tier: tierInfo.tier,
      description: tierInfo.description,
      rankingEffort: tierInfo.rankingEffort,
    };
  });

  const avgKd = items.length > 0 ? Math.round(totalKd / items.length) : 0;

  return {
    location: options.locationName || "United States",
    language: options.languageName || "English",
    count: items.length,
    averageDifficulty: avgKd,
    items,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. SERP Competitors & Rankings ("Who is ranking on it")
// ────────────────────────────────────────────────────────────────────────────

export interface SerpWhoIsRankingOptions {
  locationName?: string;
  locationCode?: number;
  languageName?: string;
  languageCode?: string;
  depth?: number;
}

export interface SerpOrganicRanking {
  rank: number;
  rankAbsolute: number;
  domain: string;
  url: string;
  title: string;
  description: string;
  breadcrumb?: string;
  websiteName?: string;
  highlighted?: string[];
}

export interface SerpWhoIsRankingResult {
  keyword: string;
  location: string;
  language: string;
  checkUrl?: string;
  totalResults?: number;
  topRankingDomains: Array<{ rank: number; domain: string; url: string }>;
  aiOverview?: {
    detected: boolean;
    markdown?: string;
    references?: Array<{ title?: string; domain?: string; url?: string }>;
  };
  featuredSnippet?: {
    detected: boolean;
    title?: string;
    description?: string;
    domain?: string;
    url?: string;
  };
  peopleAlsoAsk: Array<{ question: string; answer?: string }>;
  discussionsAndForums: Array<{ title: string; domain?: string; url?: string; source?: string }>;
  organicRankings: SerpOrganicRanking[];
}

export async function getDataForSeoSerpWhoIsRanking(
  keyword: string,
  options: SerpWhoIsRankingOptions = {},
  authHeader: string,
): Promise<SerpWhoIsRankingResult> {
  const cleanKw = keyword.trim();
  if (!cleanKw) {
    throw new Error("Keyword cannot be empty for SERP analysis.");
  }

  const taskPayload: Record<string, any> = {
    keyword: cleanKw,
    location_name: options.locationName || "United States",
    language_name: options.languageName || "English",
    depth: options.depth || 20,
  };
  if (options.locationCode) taskPayload.location_code = options.locationCode;
  if (options.languageCode) taskPayload.language_code = options.languageCode;

  const results = await callDataForSeo<Record<string, any>>(
    "/serp/google/organic/live/advanced",
    [taskPayload],
    authHeader,
  );

  const res = results[0];
  const rawItems: any[] = (res && Array.isArray(res.items)) ? res.items : [];

  const organicRankings: SerpOrganicRanking[] = [];
  let aiOverview: SerpWhoIsRankingResult["aiOverview"] = undefined;
  let featuredSnippet: SerpWhoIsRankingResult["featuredSnippet"] = undefined;
  const peopleAlsoAsk: SerpWhoIsRankingResult["peopleAlsoAsk"] = [];
  const discussionsAndForums: SerpWhoIsRankingResult["discussionsAndForums"] = [];

  for (const item of rawItems) {
    if (item.type === "organic") {
      organicRankings.push({
        rank: item.rank_group || (organicRankings.length + 1),
        rankAbsolute: item.rank_absolute || item.rank_group || 0,
        domain: item.domain || "",
        url: item.url || "",
        title: item.title || "",
        description: item.description || "",
        breadcrumb: item.breadcrumb || undefined,
        websiteName: item.website_name || undefined,
        highlighted: Array.isArray(item.highlighted) ? item.highlighted : undefined,
      });
    } else if (item.type === "ai_overview") {
      aiOverview = {
        detected: true,
        markdown: item.markdown || undefined,
        references: Array.isArray(item.references)
          ? item.references.map((r: any) => ({
              title: r.title,
              domain: r.domain,
              url: r.url,
            }))
          : undefined,
      };
    } else if (item.type === "featured_snippet") {
      featuredSnippet = {
        detected: true,
        title: item.title,
        description: item.description,
        domain: item.domain,
        url: item.url,
      };
    } else if (item.type === "people_also_ask" && Array.isArray(item.items)) {
      for (const paa of item.items) {
        if (paa.title || paa.seed_question) {
          peopleAlsoAsk.push({
            question: paa.title || paa.seed_question,
            answer: paa.expanded_element?.[0]?.description,
          });
        }
      }
    } else if (
      (item.type === "perspectives" || item.type === "discussions_and_forums") &&
      Array.isArray(item.items)
    ) {
      for (const disc of item.items) {
        discussionsAndForums.push({
          title: disc.title || "",
          domain: disc.domain || "",
          url: disc.url || "",
          source: disc.source || undefined,
        });
      }
    }
  }

  const topRankingDomains = organicRankings.slice(0, 10).map((o) => ({
    rank: o.rank,
    domain: o.domain,
    url: o.url,
  }));

  return {
    keyword: cleanKw,
    location: options.locationName || "United States",
    language: options.languageName || "English",
    checkUrl: res?.check_url || undefined,
    totalResults: res?.se_results_count || undefined,
    topRankingDomains,
    aiOverview,
    featuredSnippet,
    peopleAlsoAsk,
    discussionsAndForums,
    organicRankings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. SERP Competitors
// ────────────────────────────────────────────────────────────────────────────

export interface SerpCompetitorsOptions {
  locationName?: string;
  locationCode?: number;
  languageName?: string;
  languageCode?: string;
}

export interface SerpCompetitorItem {
  domain: string;
  avgPosition: number;
  medianPosition: number;
  rating: number;
  estimatedTrafficVolume: number;
  keywordsCount: number;
  visibility: number;
  keywordsPositions?: Record<string, number[]>;
}

export interface SerpCompetitorsResult {
  keywords: string[];
  location: string;
  language: string;
  competitorCount: number;
  competitors: SerpCompetitorItem[];
}

export async function getDataForSeoSerpCompetitors(
  keywords: string[],
  options: SerpCompetitorsOptions = {},
  authHeader: string,
): Promise<SerpCompetitorsResult> {
  const cleanKeywords = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleanKeywords.length === 0) {
    throw new Error("No valid keywords provided for SERP competitors analysis.");
  }

  const taskPayload: Record<string, any> = {
    keywords: cleanKeywords,
    location_name: options.locationName || "United States",
    language_name: options.languageName || "English",
  };
  if (options.locationCode) taskPayload.location_code = options.locationCode;
  if (options.languageCode) taskPayload.language_code = options.languageCode;

  const results = await callDataForSeo<Record<string, any>>(
    "/dataforseo_labs/google/serp_competitors/live",
    [taskPayload],
    authHeader,
  );

  const res = results[0];
  const rawItems: any[] = (res && Array.isArray(res.items)) ? res.items : [];

  const competitors: SerpCompetitorItem[] = rawItems.map((c) => ({
    domain: c.domain || "",
    avgPosition: typeof c.avg_position === "number" ? c.avg_position : 0,
    medianPosition: typeof c.median_position === "number" ? c.median_position : 0,
    rating: typeof c.rating === "number" ? c.rating : 0,
    estimatedTrafficVolume: typeof c.etv === "number" ? Math.round(c.etv * 100) / 100 : 0,
    keywordsCount: typeof c.keywords_count === "number" ? c.keywords_count : 0,
    visibility: typeof c.visibility === "number" ? c.visibility : 0,
    keywordsPositions: c.keywords_positions || undefined,
  }));

  return {
    keywords: cleanKeywords,
    location: options.locationName || "United States",
    language: options.languageName || "English",
    competitorCount: competitors.length,
    competitors,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Domain Ranked Keywords
// ────────────────────────────────────────────────────────────────────────────

export interface RankedKeywordsOptions {
  locationName?: string;
  languageName?: string;
  limit?: number;
  orderBy?: string;
}

export interface RankedKeywordItem {
  keyword: string;
  rank: number;
  rankAbsolute: number;
  url: string;
  title?: string;
  searchVolume?: number;
  cpc?: number;
  competition?: string | number;
  keywordDifficulty?: number;
  estimatedTraffic?: number;
  searchIntent?: string;
  monthlySearches?: Array<{ year: number; month: number; search_volume: number }>;
}

export interface RankedKeywordsResult {
  target: string;
  totalReturned: number;
  items: RankedKeywordItem[];
}

export async function getDataForSeoRankedKeywords(
  target: string,
  options: RankedKeywordsOptions = {},
  authHeader: string,
): Promise<RankedKeywordsResult> {
  const cleaned = cleanTarget(target);
  const taskPayload = {
    target: cleaned,
    location_name: options.locationName || "United States",
    language_name: options.languageName || "English",
    limit: options.limit || 50,
    order_by: options.orderBy ? [options.orderBy] : ["ranked_serp_element.serp_item.rank_group,asc"],
  };

  const results = await callDataForSeo<Record<string, any>>(
    "/dataforseo_labs/google/ranked_keywords/live",
    [taskPayload],
    authHeader,
  );

  const res = results[0];
  const rawItems: any[] = (res && Array.isArray(res.items)) ? res.items : [];

  const items: RankedKeywordItem[] = rawItems.map((rk) => {
    const kd = rk.keyword_data || {};
    const kwInfo = kd.keyword_info || {};
    const kwProps = kd.keyword_properties || {};
    const serpItem = rk.ranked_serp_element?.serp_item || {};

    return {
      keyword: kd.keyword || "",
      rank: serpItem.rank_group || 0,
      rankAbsolute: serpItem.rank_absolute || 0,
      url: serpItem.url || "",
      title: serpItem.title || undefined,
      searchVolume: typeof kwInfo.search_volume === "number" ? kwInfo.search_volume : undefined,
      cpc: typeof kwInfo.cpc === "number" ? Math.round(kwInfo.cpc * 100) / 100 : undefined,
      competition: kwInfo.competition_level ?? kwInfo.competition,
      keywordDifficulty: typeof kwProps.keyword_difficulty === "number" ? kwProps.keyword_difficulty : undefined,
      estimatedTraffic: typeof serpItem.etv === "number" ? Math.round(serpItem.etv * 100) / 100 : undefined,
      searchIntent: kd.search_intent_info?.main_intent || undefined,
      monthlySearches: kwInfo.monthly_searches || undefined,
    };
  });

  return {
    target: cleaned,
    totalReturned: items.length,
    items,
  };
}
