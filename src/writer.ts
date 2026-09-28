import type { SeoWriterInput, SeoWriterOutput } from "./types";
import { writeCategoryContent } from "./category-writer";
import { writeMagazineContent } from "./magazine-writer";
import { writeManufacturerContent } from "./manufacturer-writer";
import { writeProductContent } from "./product-writer";
import { writeSeoContentLegacy } from "./legacy-writer";

/** BodyNutrition Writer router. Dedicated writers for all core SEO page types. */
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
  switch (input.pageType) {
    case "category":
      return writeCategoryContent(apiKeyRaw, input, model || "claude-sonnet-5");
    case "product":
      return writeProductContent(apiKeyRaw, input, model || "claude-sonnet-5");
    case "manufacturer":
      return writeManufacturerContent(apiKeyRaw, input, model || "claude-sonnet-5");
    case "magazine":
      return writeMagazineContent(apiKeyRaw, input, model || "claude-sonnet-5");
    case "landing":
      return writeSeoContentLegacy(apiKeyRaw, input as any, model);
    default: {
      const neverType: never = input.pageType;
      throw new Error(`Unsupported Writer pageType: ${neverType}`);
    }
  }
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
