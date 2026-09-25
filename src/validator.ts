import type { ContentFingerprint } from "./types";

export interface FingerprintValidationResult {
  status: "PASS" | "FAIL" | "WARNING";
  reasons: string[];
}

function norm(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function validateCategoryFingerprint(
  current: ContentFingerprint,
  previous: ContentFingerprint[],
): FingerprintValidationResult {
  const reasons: string[] = [];
  const opening = norm(current.opening);
  const angle = norm(current.editorial_angle);
  const h2 = current.h2_structure.map(norm);
  const faq = current.faq_topics.map(norm);

  for (const old of previous) {
    if (opening && norm(old.opening) === opening) reasons.push(`Opening duplicated from entity ${old.entity_id ?? "unknown"}.`);
    if (angle && norm(old.editorial_angle) === angle) reasons.push(`Editorial angle duplicated from entity ${old.entity_id ?? "unknown"}.`);

    const oldH2 = new Set(old.h2_structure.map(norm));
    const h2Overlap = h2.filter(x => oldH2.has(x)).length;
    if (h2.length >= 2 && h2Overlap / h2.length >= 0.75) {
      reasons.push(`H2 structure strongly overlaps entity ${old.entity_id ?? "unknown"}.`);
    }

    const oldFaq = new Set(old.faq_topics.map(norm));
    const faqOverlap = faq.filter(x => oldFaq.has(x)).length;
    if (faq.length >= 3 && faqOverlap / faq.length >= 0.75) {
      reasons.push(`FAQ topics strongly overlap entity ${old.entity_id ?? "unknown"}.`);
    }
  }

  if (reasons.length) return { status: "FAIL", reasons };
  if (!current.catalog_evidence_used.length) {
    return { status: "WARNING", reasons: ["No proprietary catalog evidence recorded in fingerprint."] };
  }
  return { status: "PASS", reasons: [] };
}
