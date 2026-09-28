import type { ContentFingerprint, SeoWriterInput, SeoWriterOutput } from "./types";

interface AnthropicResponse { model?: string; stop_reason?: string; content?: Array<{type:string;text?:string}>; usage?: {input_tokens?:number;output_tokens?:number}; }
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `
You are the MAGAZINE WRITER for BodyNutrition.biz, downstream from the BodyNutrition SEO Radar.
You execute the supplied strategy; you do not redesign it.

FACTUAL / SCIENTIFIC RULES
- Existing content is context, not verified truth. Correct unsupported or outdated statements when the dossier requires it.
- Never invent studies, statistics, references, products, dosages, certifications, URLs, categories, claims or regulatory approvals.
- Distinguish established evidence, mixed/limited evidence, emerging research, traditional use and common practice.
- Never turn generic ingredient research into a claim about a BodyNutrition product.
- Use health/performance language cautiously and only within the verified brief.

EDITORIAL RULES
- Magazine is genuinely editorial, not a disguised category/product page.
- Answer the primary intent early, then develop the useful sub-intents supplied by Radar.
- Do not add H1: the CMS renders it.
- Do not force a fixed number of H2s, FAQs or words.
- For INTEGRARE, preserve valuable ranking content and supplied CONTENT TO PRESERVE while removing repetition and contradictions.
- When the dossier describes a merge, consolidate into one coherent article; never concatenate source articles.
- FAQ are optional: include them only when supported by search/user evidence.
- Use only VERIFIED INTERNAL LINKS; never invent or alter URLs.
- %products% is special: never invent it. If and only if the exact token is present in EXISTING CONTENT or explicitly listed in CONTENT TO PRESERVE, preserve it exactly once in a natural existing location.
- Preserve existing image HTML only when explicitly requested in CONTENT TO PRESERVE; do not invent image URLs.

FIELD MAPPING
- main_description = the complete long-form Magazine article body.
- additional_description = a concise supporting intro/summary only when useful to the existing CMS field; never duplicate the article body.

ORIGINALITY / MEMORY
Study APPROVED/PUBLISHED fingerprints. Do not recycle openings, H2 progression, editorial angle, FAQ formulations, CTA patterns or narrative sequence.

OUTPUT
Return only JSON matching the schema. The fingerprint must describe the content actually written.`;

const OUTPUT_SCHEMA = {
  type:"object", properties:{
    meta_title:{type:"string"}, meta_description:{type:"string"}, main_description:{type:"string"}, additional_description:{type:"string"},
    warnings:{type:"array",items:{type:"string"}},
    fingerprint:{type:"object",properties:{
      opening:{type:"string"}, h2_structure:{type:"array",items:{type:"string"}}, editorial_angle:{type:"string"},
      cta_patterns:{type:"array",items:{type:"string"}}, faq_topics:{type:"array",items:{type:"string"}}, structure_type:{type:"string"},
      catalog_evidence_used:{type:"array",items:{type:"string"}}, serp_gap_used:{type:"string"}
    },required:["opening","h2_structure","editorial_angle","cta_patterns","faq_topics","structure_type","catalog_evidence_used","serp_gap_used"],additionalProperties:false}
  }, required:["meta_title","meta_description","main_description","additional_description","warnings","fingerprint"], additionalProperties:false
};

function cleanApiKey(v:unknown){ return typeof v === "string" ? v.replace(/^[\uFEFF\u200B-\u200D\uFEFF]/g,"").replace(/[\r\n]/g,"").replace(/^["']|["']$/g,"").trim() : ""; }
function prompt(input:SeoWriterInput){ return `BODYNUTRITION MAGAZINE DOSSIER\nMARKET: ${input.market}\nLANGUAGE: ${input.language}\nPAGE ID: ${input.pageId ?? "not supplied"}\nURL: ${input.url ?? "not supplied"}\nDECISION: ${input.decision}\nCLUSTER: ${input.cluster ?? "not supplied"}\nSEARCH INTENT: ${input.searchIntent}\nPRIMARY KEYWORD: ${input.primaryKeyword}\nSECONDARY KEYWORDS: ${JSON.stringify(input.secondaryKeywords ?? [],null,2)}\n\nPROPOSED EDITORIAL ANGLE\n${input.proposedEditorialAngle ?? "not supplied"}\n\nSERP GAP\n${input.serpGap ?? "not supplied"}\n\nVERIFIED FACTS\n${JSON.stringify(input.verifiedCatalogFacts ?? [],null,2)}\n\nCATALOG EVIDENCE\n${JSON.stringify(input.catalogEvidence ?? [],null,2)}\n\nSEO / SEARCH EVIDENCE\n${JSON.stringify(input.seoEvidence ?? [],null,2)}\n\nVERIFIED INTERNAL LINKS\n${JSON.stringify(input.verifiedInternalLinks ?? [],null,2)}\n\nEXISTING CONTENT — CONTEXT ONLY\n${input.existingContent ?? "not supplied"}\n\nCONTENT TO PRESERVE\n${JSON.stringify(input.contentToPreserve ?? [],null,2)}\n\nEDITORIAL MEMORY\n${JSON.stringify(input.priorFingerprints ?? [],null,2)}\n\nRADAR INSTRUCTIONS\n${input.instructions ?? "none"}\n\nWrite the final Magazine fields and a truthful fingerprint.`; }

export async function writeMagazineContent(apiKeyRaw:string,input:SeoWriterInput,model=DEFAULT_MODEL):Promise<{provider:"anthropic";model:string;content:SeoWriterOutput;usage?:{input_tokens?:number;output_tokens?:number}}>{
  const apiKey=cleanApiKey(apiKeyRaw); const selectedModel=model?.trim()||DEFAULT_MODEL;
  if(!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  if(input.pageType!=="magazine") throw new Error("Magazine Writer only accepts pageType=magazine.");
  if(!input.language?.trim()||!input.market?.trim()||!input.searchIntent?.trim()||!input.primaryKeyword?.trim()) throw new Error("language, market, searchIntent and primaryKeyword are required.");
  if(input.decision!=="INTEGRARE"&&input.decision!=="RISCRIVERE") throw new Error("Writer may only be called for INTEGRARE or RISCRIVERE.");
  const response=await fetch(ANTHROPIC_API_URL,{method:"POST",headers:{"content-type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:selectedModel,max_tokens:12000,system:SYSTEM_PROMPT,messages:[{role:"user",content:prompt(input)}],output_config:{format:{type:"json_schema",schema:OUTPUT_SCHEMA}}})});
  const raw=await response.text(); if(!response.ok) throw new Error(`Anthropic API error ${response.status}: ${raw.slice(0,1500)}`);
  let data:AnthropicResponse; try{data=JSON.parse(raw);}catch{throw new Error("Anthropic returned an invalid API response.");}
  if(data.stop_reason==="refusal") throw new Error("Anthropic refused the Magazine Writer request.");
  if(data.stop_reason==="max_tokens") throw new Error("Anthropic Magazine Writer output was truncated because max_tokens was reached.");
  if(data.stop_reason&&data.stop_reason!=="end_turn") throw new Error(`Anthropic Magazine Writer stopped unexpectedly: ${data.stop_reason}.`);
  const block=data.content?.find(b=>b.type==="text"&&typeof b.text==="string"); if(!block?.text) throw new Error("Anthropic returned no structured text content.");
  let content:SeoWriterOutput; try{content=JSON.parse(block.text);}catch{throw new Error("Anthropic structured output could not be parsed.");}
  if(!content.meta_title?.trim()||!content.meta_description?.trim()||!content.main_description?.trim()) throw new Error("Magazine Writer returned incomplete required content fields.");
  if(/<h1\b/i.test(content.main_description)) throw new Error("Magazine Writer returned an H1 inside main_description.");
  const shouldPreserveProducts=(input.existingContent??"").includes("%products%")||(input.contentToPreserve??[]).some(x=>x.includes("%products%"));
  const productTokens=(content.main_description.match(/%products%/g)||[]).length+(content.additional_description.match(/%products%/g)||[]).length;
  if(shouldPreserveProducts&&productTokens!==1) throw new Error("Magazine Writer must preserve %products% exactly once.");
  if(!shouldPreserveProducts&&productTokens>0) throw new Error("Magazine Writer invented %products%.");
  const fp=content.fingerprint as ContentFingerprint|undefined; if(!fp) throw new Error("Magazine Writer returned no editorial fingerprint.");
  fp.entity_type="magazine"; fp.entity_id=input.pageId; fp.language=input.language; fp.market=input.market; fp.cluster=input.cluster; fp.writer_model=data.model??selectedModel;
  return {provider:"anthropic",model:data.model??selectedModel,content,usage:data.usage};
}
