import { createResource } from "./createResource";
import type {
  Credential,
  LlmProvider,
  OcrProvider,
  VisionLlmProvider,
} from "@/types";

// Provider + credential lists. Consumed by multiple settings tabs and
// document-level menus, so we cache shared per-URL state and let callers
// refetch after edits.
export const useCredentials = createResource<Credential[]>(
  "/settings/credentials",
);
export const useLlmProviders = createResource<LlmProvider[]>(
  "/settings/llm-providers",
);
export const useVisionProviders = createResource<VisionLlmProvider[]>(
  "/settings/vision-providers",
);
export const useOcrProviders = createResource<OcrProvider[]>(
  "/settings/ocr-providers",
);
