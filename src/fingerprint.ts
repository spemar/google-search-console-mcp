import type { ContentFingerprint } from "./types";

export function normalizeFingerprint(fp: ContentFingerprint): ContentFingerprint {
  const uniq = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))];
  return {
    ...fp,
    opening: fp.opening.trim(),
    h2_structure: uniq(fp.h2_structure ?? []),
    editorial_angle: fp.editorial_angle.trim(),
    cta_patterns: uniq(fp.cta_patterns ?? []),
    faq_topics: uniq(fp.faq_topics ?? []),
    structure_type: fp.structure_type.trim(),
    catalog_evidence_used: uniq(fp.catalog_evidence_used ?? []),
    serp_gap_used: fp.serp_gap_used.trim(),
  };
}
