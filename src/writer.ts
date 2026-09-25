import type { SeoWriterInput, SeoWriterOutput } from "./types";
import { writeCategoryContent } from "./category-writer";
import { writeSeoContentLegacy } from "./legacy-writer";

/**
 * BodyNutrition Writer router.
 *
 * Phase 1:
 * - category -> new dedicated Category Writer + editorial fingerprint
 * - product/magazine/landing -> preserved legacy Writer behavior
 *
 * Manufacturer is declared in the shared types but intentionally blocked
 * until its dedicated writer is implemented; it must never silently fall
 * back to an unrelated prompt.
 */
export async function writeSeoContent(
  apiKeyRaw: string,
  input: SeoWriterInput,
  model?: string,
): Promise<{
  provider: "anthropic";
  model: string;
  content: SeoWriterOutput;
  usage?: { input_tokens?: number; output_tokens?: number };
}> {
  if (input.pageType === "category") {
    return writeCategoryContent(apiKeyRaw, input, model || "claude-sonnet-5");
  }

  if (input.pageType === "manufacturer") {
    throw new Error(
      "Manufacturer Writer is not implemented yet. Refusing legacy fallback.",
    );
  }

  // Temporary compatibility bridge while Product/Magazine/Landing are refactored.
  return writeSeoContentLegacy(apiKeyRaw, input as any, model);
}

export type {
  ContentFingerprint,
  SeoContentFields,
  SeoWriterInput,
  SeoWriterOutput,
  VerifiedInternalLink,
  WriterDecision,
  WriterPageType,
} from "./types";
