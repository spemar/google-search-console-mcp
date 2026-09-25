export type WriterPageType =
  | "category"
  | "product"
  | "magazine"
  | "landing";

export type WriterDecision =
  | "INTEGRARE"
  | "RISCRIVERE";

export interface VerifiedInternalLink {
  label: string;
  url: string;
  type?:
    | "shop_category"
    | "magazine_category"
    | "magazine_article"
    | "product"
    | "landing"
    | "other";
  context?: string;
}

export interface SeoWriterInput {
  language: string;
  market: string;

  pageType: WriterPageType;

  pageId?: string;
  url?: string;

  decision: WriterDecision;

  searchIntent: string;

  primaryKeyword: string;
  secondaryKeywords?: string[];

  /**
   * Facts verified by Radar through trusted sources such as
   * PrestaShop MCP or other authoritative project data.
   *
   * ONLY these may be treated as confirmed facts about the
   * BodyNutrition catalog/page/products.
   */
  verifiedCatalogFacts?: string[];

  /**
   * URLs verified before calling the Writer.
   * Claude may choose whether and where to use them,
   * but must never invent URLs.
   */
  verifiedInternalLinks?: VerifiedInternalLink[];

  /**
   * Current page content.
   *
   * IMPORTANT:
   * Existing content is context, not automatically verified truth.
   */
  existingContent?: string;

  /**
   * Semantic/factual elements that Radar explicitly wants preserved.
   */
  contentToPreserve?: string[];

  /**
   * GSC, SERP, DataForSEO or other SEO evidence selected by Radar.
   * This guides writing strategy but is NOT catalog evidence.
   */
  seoEvidence?: string[];

  /**
   * Page-specific instructions produced by Radar/ChatGPT.
   */
  instructions?: string;
}

export interface SeoWriterOutput {
  meta_title: string;
  meta_description: string;
  main_description: string;
  additional_description: string;
  warnings: string[];
}

interface AnthropicResponse {
  id?: string;
  model?: string;
  stop_reason?: string;

  content?: Array<{
    type: string;
    text?: string;
  }>;

  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

const ANTHROPIC_API_URL =
  "https://api.anthropic.com/v1/messages";

const DEFAULT_MODEL =
  "claude-opus-5-5";

/**
 * Permanent editorial policy for the BodyNutrition SEO Writer.
 *
 * The Writer executes an SEO strategy prepared upstream by Radar.
 * It does NOT independently decide what should be optimized.
 */
const SYSTEM_PROMPT = `
You are the SEO Writer for BodyNutrition.biz.

ROLE
You are a professional multilingual SEO copywriter working downstream
from the BodyNutrition SEO Radar.

You are NOT the SEO strategist.

The SEO Radar decides:
- which page should be optimized;
- whether the decision is INTEGRARE or RISCRIVERE;
- search intent;
- primary and secondary keywords;
- verified catalog facts;
- SEO evidence;
- verified internal links;
- content that must be preserved;
- page-specific instructions.

Follow that strategy exactly.

Do not independently change the SEO strategy.

==================================================
GENERAL WRITING RULES
==================================================

1. Write in native, natural language for the specified market.

2. Localize naturally.
Do not mechanically translate from another language.

3. Respect the supplied search intent.

4. Use the primary and secondary keywords naturally.
Never keyword-stuff.

5. Correctly distinguish between:
- Product
- Category
- Magazine
- Landing page

6. Preserve useful semantic coverage when Radar explicitly requests it.

7. Do not remove useful information merely to make content shorter.

8. Never invent facts.

9. Never invent:
- products;
- product formats;
- ingredients;
- dosages;
- certifications;
- brands;
- stock;
- prices;
- discounts;
- delivery conditions;
- reviews;
- studies;
- scientific references;
- regulatory approvals;
- URLs;
- internal links;
- categories.

10. A keyword or SEO topic is NOT evidence that BodyNutrition sells
a corresponding product, format or ingredient.

Example:
If "ashwagandha powder" is supplied as a keyword, this does NOT mean
BodyNutrition currently sells Ashwagandha powder.

11. Only VERIFIED CATALOG FACTS supplied in the brief may be treated
as confirmed facts about BodyNutrition's current catalog, assortment,
product or page.

12. Existing content is context.
It is NOT automatically verified factual evidence.

13. If information required for a factual statement is missing,
do not guess.

Either:
- phrase the information generically when appropriate; or
- report the issue in warnings.

==================================================
HEALTH AND CLAIM SAFETY
==================================================

14. Never invent or exaggerate medical, therapeutic, physiological,
health or performance claims.

15. Never imply diagnosis, treatment, prevention or cure of disease
unless the supplied brief explicitly contains valid, verified wording
that permits it.

16. Do not convert:
- SEO keywords;
- traditional uses;
- consumer associations;
- general ingredient information;
- existing unverified page text

into claims about an individual BodyNutrition product.

==================================================
PRODUCT PAGES
==================================================

17. PRODUCT CLAIMS MUST BE STRICTLY CONTROLLED.

For Product pages:
- use health, nutritional, functional or performance claims only when
  explicitly supported by verified facts supplied in the brief;
- verified product information overrides assumptions;
- never transfer general benefits associated with an ingredient to the
  specific product unless supported by the verified facts;
- never infer dosage, concentration, standardization, certification or
  intended effect;
- keep the copy commercially useful without exaggerating claims.

A Product page requires the highest level of factual restraint.

==================================================
CATEGORY PAGES — GENERAL PRINCIPLE
==================================================

18. Category pages may provide broader educational and semantic
coverage than individual Product pages.

A category may explain:
- what the category is;
- why consumers search for it;
- the ingredients or supplement types normally associated with the topic;
- differences between forms or formats;
- criteria useful when choosing products;
- relevant terminology;
- general usage context.

However:

Do NOT imply that every product in the category has every characteristic
or provides every effect discussed in the category text.

Always distinguish general category information from claims about
individual products.

==================================================
BOTANICAL / WELLNESS / HEALTH GOALS CATEGORIES
==================================================

19. For botanical ingredients and appropriate wellness categories,
traditional-use language may be used when relevant and factually
appropriate.

Natural formulations may include equivalents of:

- "traditionally used for..."
- "in traditional herbal practice..."
- "traditionally associated with..."
- "ingredients traditionally used in the context of..."

Use natural wording in the target language.

20. Traditional use is NOT scientific proof.

Traditional-use wording does NOT authorize:
- therapeutic claims;
- disease treatment claims;
- disease prevention claims;
- guaranteed effects.

Do not imply that every product in the category provides the
traditionally associated effect.

21. For:
- Health Goals;
- Everyday Wellness;
- Manage Weight;
- related wellness subcategories;

prefer an editorial-informational framing around:
- the consumer need or topic;
- relevant ingredients;
- traditional use where appropriate;
- practical product-selection criteria.

Individual Product claims remain strictly controlled.

==================================================
SPORTS NUTRITION / ENERGY & PERFORMANCE CATEGORIES
==================================================

22. For Sports Nutrition, Energy & Performance and their subcategories,
category pages may use broader educational and semantic coverage than
individual Product pages.

Appropriate topics may include:
- the role of the supplement category in sports nutrition;
- why athletes and active consumers commonly search for or use it;
- main forms and types;
- differences between forms;
- typical usage context;
- practical selection criteria;
- terminology commonly used in sports nutrition.

23. Prefer factual educational formulations equivalent to:

- "commonly used in sports nutrition..."
- "often chosen by athletes..."
- "used in the context of..."
- "commonly included in..."
- "frequently considered when..."

Use natural wording in the target language.

24. Do not use "traditional use" wording for sports nutrition
ingredients when it would be unnatural or misleading.

For example, creatine should normally be discussed in the context of
sports nutrition rather than herbal tradition.

25. General educational information about an ingredient or supplement
category must remain clearly separate from claims about an individual
BodyNutrition product.

==================================================
MAGAZINE CONTENT
==================================================

26. Magazine pages are editorial and informational content.

They may provide substantially deeper coverage than Category or Product
pages.

27. Magazine content should comprehensively answer the supplied search
intent.

When relevant and supported by the brief, it may explain:
- definitions;
- mechanisms;
- context of use;
- practical considerations;
- forms;
- comparisons;
- timing;
- common usage;
- traditional background;
- scientific context;
- advantages and limitations.

28. Clearly distinguish between:

- established evidence;
- emerging research;
- mixed or limited evidence;
- traditional use;
- common practice;
- general consumer usage.

29. Never present traditional use as scientific proof.

30. When evidence is limited, mixed or preliminary, use appropriately
cautious language.

31. Never invent:
- studies;
- statistics;
- scientific references;
- regulatory approvals.

32. If scientific evidence or references are explicitly supplied in
the brief, represent them accurately and do not exaggerate their
conclusions.

33. Do not transform general ingredient research into claims about
BodyNutrition products.

34. Magazine content must remain genuinely editorial and informative.
Do not turn the article into a disguised Product or Category page.

35. Never use %products% in Magazine content.

36. Do not add an H1 when the Magazine/CMS template generates the H1.

==================================================
INTERNAL LINKS
==================================================

37. Never invent an internal URL.

38. Internal links may ONLY use URLs explicitly supplied in
VERIFIED INTERNAL LINKS.

39. VERIFIED INTERNAL LINKS may contain:
- Shop categories;
- Magazine categories;
- Magazine articles;
- Products;
- Landing pages;
- other verified BodyNutrition URLs.

40. You may choose natural, contextually relevant anchor text for a
verified URL.

41. Do not alter the supplied URL.

42. Do not force every supplied internal link into the content.

Use a link only when it:
- genuinely helps the reader;
- is contextually relevant;
- reinforces the search intent;
- improves navigation or semantic relationships.

43. Do not create links to pages that were not supplied in
VERIFIED INTERNAL LINKS.

==================================================
HTML AND PAGE STRUCTURE
==================================================

44. HTML is allowed in:
- main_description
- additional_description

45. Do not wrap HTML inside Markdown code fences.

46. Do not add H1 headings when the page template generates the H1.

47. Use clean semantic HTML where useful.

Avoid unnecessary wrappers, inline styles and decorative markup.

48. Do not change or propose:
- slug;
- canonical;
- redirects.

Those decisions belong to the SEO Radar.

==================================================
OUTPUT DISCIPLINE
==================================================

49. Return only the requested structured fields.

50. Do not include SEO strategy commentary inside the generated content.

51. Use warnings when:
- factual information is missing;
- a requested keyword would require an unsupported claim;
- an internal link would need to be invented;
- existing content conflicts with verified facts;
- the brief contains an ambiguity that prevents safe factual writing.

The purpose of warnings is to allow ChatGPT/Radar to perform QA before
anything is published.

The Writer NEVER publishes directly.
`;

const OUTPUT_SCHEMA = {
  type: "object",

  properties: {
    meta_title: {
      type: "string",
    },

    meta_description: {
      type: "string",
    },

    main_description: {
      type: "string",
    },

    additional_description: {
      type: "string",
    },

    warnings: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },

  required: [
    "meta_title",
    "meta_description",
    "main_description",
    "additional_description",
    "warnings",
  ],

  additionalProperties: false,
};

function cleanApiKey(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .replace(/^[\uFEFF\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n]/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function buildWriterPrompt(input: SeoWriterInput): string {
  return `
BODYNUTRITION SEO RADAR — WRITER BRIEF

==================================================
MARKET
==================================================

${input.market}

==================================================
LANGUAGE
==================================================

${input.language}

==================================================
PAGE TYPE
==================================================

${input.pageType}

==================================================
PAGE ID
==================================================

${input.pageId ?? "not supplied"}

==================================================
URL
==================================================

${input.url ?? "not supplied"}

==================================================
SEO DECISION
==================================================

${input.decision}

==================================================
SEARCH INTENT
==================================================

${input.searchIntent}

==================================================
PRIMARY KEYWORD
==================================================

${input.primaryKeyword}

==================================================
SECONDARY KEYWORDS / TOPICS TO COVER
==================================================

${JSON.stringify(
  input.secondaryKeywords ?? [],
  null,
  2,
)}

IMPORTANT:
Keywords and topics are SEO targets.
They are NOT automatically facts about the BodyNutrition catalog.

==================================================
VERIFIED CATALOG FACTS
==================================================

${JSON.stringify(
  input.verifiedCatalogFacts ?? [],
  null,
  2,
)}

CRITICAL:
Only the facts in VERIFIED CATALOG FACTS may be treated as confirmed
facts about BodyNutrition's current assortment, products or page.

Do not infer catalog facts from keywords or existing content.

==================================================
VERIFIED INTERNAL LINKS
==================================================

${JSON.stringify(
  input.verifiedInternalLinks ?? [],
  null,
  2,
)}

CRITICAL:
You may only create internal links using URLs contained in the list
above.

You may choose natural anchor text.

Do not invent, modify or guess URLs.

You do not need to use every supplied link.

==================================================
SEO / SEARCH EVIDENCE
==================================================

${JSON.stringify(
  input.seoEvidence ?? [],
  null,
  2,
)}

SEO evidence guides content priorities.
It is NOT catalog evidence.

==================================================
EXISTING CONTENT
==================================================

${input.existingContent ?? "not supplied"}

IMPORTANT:
Existing content is context.
It is NOT automatically verified factual evidence.

==================================================
CONTENT THAT MUST BE PRESERVED
==================================================

${JSON.stringify(
  input.contentToPreserve ?? [],
  null,
  2,
)}

==================================================
ADDITIONAL RADAR INSTRUCTIONS
==================================================

${input.instructions ?? "none"}

==================================================
PAGE-SPECIFIC OUTPUT GUIDANCE
==================================================

CATEGORY

If pageType = category:

- write a strong SEO meta title;
- write an attractive meta description;
- main_description should provide a concise category introduction;
- additional_description should provide deeper semantic and
  informational coverage;
- do not add H1;
- distinguish general category information from individual product
  claims;
- use verified internal links naturally when useful.

For botanical/wellness categories:
traditional-use framing may be appropriate.

For sports nutrition categories:
prefer factual sports-nutrition context rather than traditional-use
language.

--------------------------------------------------

PRODUCT

If pageType = product:

- do not invent specifications;
- do not infer benefits from the ingredient name;
- verified product facts override assumptions;
- apply strict claim control;
- keep the copy commercially useful and natural;
- use only supplied verified links if internal linking is requested.

--------------------------------------------------

MAGAZINE

If pageType = magazine:

- meta_title is the SEO title;
- meta_description is the search snippet;
- provide genuinely useful editorial depth;
- distinguish evidence, traditional use and common practice;
- do not add H1 when generated by the CMS;
- never output %products%;
- never invent products, Shop categories, Magazine categories,
  articles, URLs or internal links;
- use VERIFIED INTERNAL LINKS naturally where they genuinely help
  the reader.

--------------------------------------------------

LANDING

If pageType = landing:

- follow the supplied intent;
- use only verified facts;
- do not invent commercial conditions;
- do not invent claims;
- use only verified URLs.

==================================================
FINAL INSTRUCTION
==================================================

Execute the supplied SEO strategy.

Do not redesign the strategy.

If a keyword cannot safely be converted into a factual statement,
cover the topic generically where appropriate or report the issue
in warnings.

Return only the required structured output.
`;
}

export async function writeSeoContentLegacy(
  apiKeyRaw: string,
  input: SeoWriterInput,
  model = DEFAULT_MODEL,
): Promise<{
  provider: "anthropic";
  model: string;

  content: SeoWriterOutput;

  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}> {
  const apiKey = cleanApiKey(apiKeyRaw);

  const selectedModel =
    model?.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured.",
    );
  }

  if (!input.language?.trim()) {
    throw new Error("language is required.");
  }

  if (!input.market?.trim()) {
    throw new Error("market is required.");
  }

  if (!input.searchIntent?.trim()) {
    throw new Error("searchIntent is required.");
  }

  if (!input.primaryKeyword?.trim()) {
    throw new Error("primaryKeyword is required.");
  }

  if (
    input.decision !== "INTEGRARE" &&
    input.decision !== "RISCRIVERE"
  ) {
    throw new Error(
      "Writer may only be called for INTEGRARE or RISCRIVERE.",
    );
  }

  const response = await fetch(
    ANTHROPIC_API_URL,
    {
      method: "POST",

      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },

      body: JSON.stringify({
        model: selectedModel,

        max_tokens: 6000,

        system: SYSTEM_PROMPT,

        messages: [
          {
            role: "user",
            content: buildWriterPrompt(input),
          },
        ],

        output_config: {
          effort: "medium",

          format: {
            type: "json_schema",
            schema: OUTPUT_SCHEMA,
          },
        },
      }),
    },
  );

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Anthropic API error ${response.status}: ${rawText.slice(
        0,
        1500,
      )}`,
    );
  }

  let data: AnthropicResponse;

  try {
    data =
      JSON.parse(rawText) as AnthropicResponse;
  } catch {
    throw new Error(
      "Anthropic returned an invalid API response.",
    );
  }

  if (data.stop_reason === "refusal") {
    throw new Error(
      "Anthropic refused the Writer request.",
    );
  }

  const textBlock =
    data.content?.find(
      (block) =>
        block.type === "text" &&
        typeof block.text === "string",
    );

  if (!textBlock?.text) {
    throw new Error(
      "Anthropic returned no structured text content.",
    );
  }

  let content: SeoWriterOutput;

  try {
    content =
      JSON.parse(
        textBlock.text,
      ) as SeoWriterOutput;
  } catch {
    throw new Error(
      "Anthropic structured output could not be parsed.",
    );
  }

  return {
    provider: "anthropic",

    model:
      data.model ??
      selectedModel,

    content,

    usage:
      data.usage,
  };
}
