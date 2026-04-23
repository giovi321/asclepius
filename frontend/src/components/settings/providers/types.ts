import {
  Cloud, HardDrive, KeyRound, Server, type LucideIcon,
} from "lucide-react";

export const CREDENTIAL_TYPES = [
  { value: "ollama", label: "Ollama", description: "Local LLM via Ollama", icon: HardDrive, needs_url: true, needs_key: false },
  { value: "vllm", label: "vLLM", description: "vLLM (OpenAI-compatible)", icon: Server, needs_url: true, needs_key: true },
  { value: "claude", label: "Anthropic (Claude)", description: "Claude API", icon: Cloud, needs_url: false, needs_key: true },
  { value: "openai", label: "OpenAI", description: "OpenAI-compatible API", icon: Cloud, needs_url: false, needs_key: true },
  { value: "google_vision", label: "Google Vision", description: "Google Cloud Vision OCR", icon: Cloud, needs_url: false, needs_key: true },
  { value: "tesseract_remote", label: "Tesseract (Remote)", description: "Remote Tesseract OCR server", icon: Server, needs_url: true, needs_key: false },
] as const;

export function iconForType(t: string): LucideIcon {
  return (CREDENTIAL_TYPES.find((x) => x.value === t)?.icon) ?? KeyRound;
}

/** Which model kinds (LLM / Vision / OCR) can attach to a credential of the given type. */
export function allowedKindsFor(credType: string): ModelKind[] {
  if (credType === "google_vision" || credType === "tesseract_remote") return ["ocr"];
  return ["llm", "vision", "ocr"];
}

export type ModelKind = "llm" | "vision" | "ocr";

export interface AttachedModel {
  kind: ModelKind;
  /** The underlying LLM/Vision/OCR-provider entry id so we can edit/remove. */
  entry_id: string;
  name: string;
  model: string;
  enabled: boolean;
  priority: number;
  timeout: number;
}
