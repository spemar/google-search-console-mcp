export type WriterPageType =
  | "category"
  | "product"
  | "manufacturer"
  | "magazine"
  | "landing";

export type WriterDecision = "INTEGRARE" | "RISCRIVERE";

export interface VerifiedInternalLink {
  label: string;
  url: string;
  type?:
    | "shop_category"
    | "magazine_category"
    | "magazine_article"
    | "product"
    | "manufacturer"
    | "landing"
    | "other";
  context?: string;
}

export interface ContentFingerprint {
  entity_type?: WriterPageType;
  entity_id?: string;
  language?: string;
  market?: string;
  cluster?: string;
  opening: string;
  h2_structure: string[];
  editorial_angle: string;
  cta_patterns: string[];
  faq_topics: string[];
  structure_type: string;
  catalog_evidence_used: string[];
  serp_gap_used: string;
  writer_model?: string;
  published_at?: string;
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
  verifiedCatalogFacts?: string[];
  verifiedInternalLinks?: VerifiedInternalLink[];
  existingContent?: string;
  contentToPreserve?: string[];
  seoEvidence?: string[];
  instructions?: string;

  /** Editorial memory retrieved upstream. Only APPROVED/PUBLISHED items belong here. */
  priorFingerprints?: ContentFingerprint[];

  /** Optional Radar dossier fields used by the new page-specific writers. */
  cluster?: string;
  proposedEditorialAngle?: string;
  serpGap?: string;
  catalogEvidence?: string[];
}

export interface SeoContentFields {
  meta_title: string;
  meta_description: string;
  main_description: string;
  additional_description: string;
}

export interface SeoWriterOutput extends SeoContentFields {
  warnings: string[];
  fingerprint?: ContentFingerprint;
  validation?: {
    status: "PASS" | "FAIL" | "WARNING";
    reasons: string[];
  };
}
