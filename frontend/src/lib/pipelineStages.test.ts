import { describe, it, expect } from "vitest";
import { STAGE_META, stageLabel } from "./pipelineStages";

describe("stageLabel", () => {
  // The canonical labels every known backend stage id should resolve to.
  // Keyed by the STAGE_* constants in backend/asclepius/pipeline/stage_events.py.
  const cases: Array<[string, string]> = [
    ["ocr", "OCR"],
    ["vision_extraction", "Vision extraction"],
    ["llm_extraction", "LLM extraction"],
    ["page_classification", "Page classification"],
    ["section_extraction", "Section extraction"],
    ["organizing", "Organizing"],
    ["thumbnail", "Thumbnail"],
    ["cache_ocr", "Cache OCR"],
    ["translation", "Translation"],
    ["region_ocr", "Region OCR"],
    ["region_translation", "Region translation"],
    ["ai_edit", "AI edit"],
  ];

  it.each(cases)("maps %s -> %s", (id, label) => {
    expect(stageLabel(id)).toBe(label);
  });

  it("has a STAGE_META entry for every known backend stage id", () => {
    for (const [id] of cases) {
      expect(STAGE_META[id]).toBeDefined();
    }
  });

  it("falls back to the id with underscores spaced for unknown stages", () => {
    expect(stageLabel("some_new_stage")).toBe("some new stage");
    expect(stageLabel("foobar")).toBe("foobar");
  });

  it("returns an empty string for empty / nullish input", () => {
    expect(stageLabel("")).toBe("");
    expect(stageLabel(null)).toBe("");
    expect(stageLabel(undefined)).toBe("");
  });
});
