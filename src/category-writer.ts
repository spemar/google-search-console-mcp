import type {
  ContentFingerprint,
  SeoWriterInput,
  SeoWriterOutput,
} from "./types";

interface AnthropicResponse {
  model?: string;
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

const CATEGORY_SYSTEM_PROMPT = `
You are the CATEGORY WRITER for BodyNutrition.biz.
You write only ecommerce category pages downstream from the BodyNutrition SEO Radar.
You are not the SEO strategist. Do not redesign the supplied strategy.

NON-NEGOTIABLE FACTUAL RULES
- Never invent products, brands, ingredients, dosages, certifications, stock, prices, claims, URLs or categories.
- Only VERIFIED CATALOG FACTS and CATALOG EVIDENCE may be treated as confirmed facts about BodyNutrition.
- Existing content is context, not verified truth.
- SEO evidence is search evidence, not catalog evidence.
- Never turn a keyword, consumer association or generic ingredient benefit into a product claim.
- Never imply every product in a category has every characteristic discussed.
- Keep health and performance claims prudent and within the verified brief.

BODYNUTRITION CATEGORY FIELD MAPPING — DO NOT INVERT
- additional_description = SHORT introduction ABOVE the products.
  It must be exactly one concise <p>...</p>, with no heading, no <strong>, no list.
- main_description = LONG editorial/SEO content BELOW the products.
  It may use clean H2/H3 HTML. Never add H1.

EDITORIAL ORIGINALITY
The category must not be generated from a reusable SEO template.
The supplied editorial memory contains fingerprints of previously APPROVED/PUBLISHED content.
Study those fingerprints before writing.
Do not reuse their openings, H2 progression, editorial angle, CTA patterns, FAQ formulations,
meta-description construction or overall narrative sequence.
Do not merely paraphrase an earlier structure.
The new page must have a reason to exist that is specific to its search demand and BodyNutrition assortment.

Do not force a fixed number of H2 sections or a fixed word count.
Let the dossier determine the architecture.
FAQ are mandatory for category pages, but questions must be specific to the category/search evidence;
do not recycle generic questions just to fill space.
Avoid habitual ecommerce openings and CTAs such as repeated "Scopri", "Scegli", "Trova", "Confronta".
They are not forbidden words, but repeated formulaic use is a failure.

VALUE-ADD RULE
Prefer concrete, verified observations from BodyNutrition's real assortment over generic encyclopedia prose.
If the supplied dossier does not support a distinctive factual angle, say so in warnings instead of padding the page.

INTERNAL LINKS
Use only verified URLs supplied in VERIFIED INTERNAL LINKS. Never invent or modify URLs.

OUTPUT
Return only the structured JSON required by the schema.
The fingerprint must truthfully describe the content you just wrote; it is editorial memory, not marketing copy.
`;

const CATEGORY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    main_description: { type: "string" },
    additional_description: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    fingerprint: {
      type: "object",
      properties: {
        opening: { type: "string" },
        h2_structure: { type: "array", items: { type: "string" } },
        editorial_angle: { type: "string" },
        cta_patterns: { type: "array", items: { type: "string" } },
        faq_topics: { type: "array", items: { type: "string" } },
        structure_type: { type: "string" },
        catalog_evidence_used: { type: "array", items: { type: "string" } },
        serp_gap_used: { type: "string" }
      },
      required: [
        "opening", "h2_structure", "editorial_angle", "cta_patterns",
        "faq_topics", "structure_type", "catalog_evidence_used", "serp_gap_used"
      ],
      additionalProperties: false
    }
  },
  required: [
    "meta_title", "meta_description", "main_description",
    "additional_description", "warnings", "fingerprint"
  ],
  additionalProperties: false
};

function cleanApiKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^[\uFEFF\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n]/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function buildCategoryPrompt(input: SeoWriterInput): string {
  return `
BODYNUTRITION CATEGORY DOSSIER

MARKET: ${input.market}
LANGUAGE: ${input.language}
PAGE ID: ${input.pageId ?? "not supplied"}
URL: ${input.url ?? "not supplied"}
DECISION: ${input.decision}
CLUSTER: ${input.cluster ?? "not supplied"}
SEARCH INTENT: ${input.searchIntent}
PRIMARY KEYWORD: ${input.primaryKeyword}
SECONDARY KEYWORDS: ${JSON.stringify(input.secondaryKeywords ?? [], null, 2)}

PROPOSED EDITORIAL ANGLE
${input.proposedEditorialAngle ?? "not supplied — derive cautiously from the dossier without inventing facts"}

SERP GAP TO ADDRESS
${input.serpGap ?? "not supplied"}

VERIFIED CATALOG FACTS
${JSON.stringify(input.verifiedCatalogFacts ?? [], null, 2)}

CATALOG EVIDENCE / PROPRIETARY BODYNUTRITION OBSERVATIONS
${JSON.stringify(input.catalogEvidence ?? [], null, 2)}

SEO / SEARCH EVIDENCE
${JSON.stringify(input.seoEvidence ?? [], null, 2)}

VERIFIED INTERNAL LINKS
${JSON.stringify(input.verifiedInternalLinks ?? [], null, 2)}

EXISTING CONTENT — CONTEXT ONLY, NOT VERIFIED TRUTH
${input.existingContent ?? "not supplied"}

CONTENT TO PRESERVE
${JSON.stringify(input.contentToPreserve ?? [], null, 2)}

EDITORIAL MEMORY — APPROVED/PUBLISHED CONTENT TO AVOID COPYING
${JSON.stringify(input.priorFingerprints ?? [], null, 2)}

ADDITIONAL RADAR INSTRUCTIONS
${input.instructions ?? "none"}

Before writing, silently compare the proposed page with EDITORIAL MEMORY.
Create a distinct architecture driven by this category's dossier.
FAQ are mandatory, but their number and wording must follow real search/user needs.
Return additional_description SHORT ABOVE products and main_description LONG BELOW products.
Return a truthful fingerprint of the generated page.
`;
}

export async function writeCategoryContent(
  apiKeyRaw: string,
  input: SeoWriterInput,
  model = DEFAULT_MODEL,
): Promise<{
  provider: "anthropic";
  model: string;
  content: SeoWriterOutput;
  usage?: { input_tokens?: number; output_tokens?: number };
}> {
  const apiKey = cleanApiKey(apiKeyRaw);
  const selectedModel = model?.trim() || DEFAULT_MODEL;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  if (input.pageType !== "category") throw new Error("Category Writer only accepts pageType=category.");
  if (!input.language?.trim()) throw new Error("language is required.");
  if (!input.market?.trim()) throw new Error("market is required.");
  if (!input.searchIntent?.trim()) throw new Error("searchIntent is required.");
  if (!input.primaryKeyword?.trim()) throw new Error("primaryKeyword is required.");
  if (input.decision !== "INTEGRARE" && input.decision !== "RISCRIVERE") {
    throw new Error("Writer may only be called for INTEGRARE or RISCRIVERE.");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 7000,
      system: CATEGORY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCategoryPrompt(input) }],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: CATEGORY_OUTPUT_SCHEMA },
      },
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}: ${rawText.slice(0, 1500)}`);
  }

  let data: AnthropicResponse;
  try { data = JSON.parse(rawText) as AnthropicResponse; }
  catch { throw new Error("Anthropic returned an invalid API response."); }
  if (data.stop_reason === "refusal") throw new Error("Anthropic refused the Category Writer request.");

  const textBlock = data.content?.find(
    (block) => block.type === "text" && typeof block.text === "string",
  );
  if (!textBlock?.text) throw new Error("Anthropic returned no structured text content.");

  let content: SeoWriterOutput;
  try { content = JSON.parse(textBlock.text) as SeoWriterOutput; }
  catch { throw new Error("Anthropic structured output could not be parsed."); }

  const fp = content.fingerprint as ContentFingerprint | undefined;
  if (fp) {
    fp.entity_type = "category";
    fp.entity_id = input.pageId;
    fp.language = input.language;
    fp.market = input.market;
    fp.cluster = input.cluster;
    fp.writer_model = data.model ?? selectedModel;
  }

  return {
    provider: "anthropic",
    model: data.model ?? selectedModel,
    content,
    usage: data.usage,
  };
}
