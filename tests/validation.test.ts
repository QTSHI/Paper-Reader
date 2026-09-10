import { describe, expect, it } from "vitest";
import { validateReadingUnit } from "../src/validation/source";
import { validateFullReadingCoverage } from "../src/validation/guide";
import type { ReadingUnit, SourceBlock, StudyGuide } from "../src/domain/types";

const block: SourceBlock = { blockId: "p0001-b0001", pageIndex: 0, order: 0, text: "The Dice score improved to 91.2%.", normalizedText: "The Dice score improved to 91.2%.", hash: "hash" };
const unit: ReadingUnit = {
  id: "u1", label: "Original 01", purpose: "result", originalText: block.text, translation: "", vocabulary: [], logic: [], validationStatus: "valid",
  source: { attachmentKey: "A", pageIndex: 0, blockId: block.blockId, quote: block.text, normalizedQuote: block.text, blockHash: block.hash },
};

describe("source validation", () => {
  it("accepts a traceable quote", () => expect(validateReadingUnit(unit, new Map([[block.blockId, block]])).valid).toBe(true));
  it("rejects a fabricated quote", () => {
    const changed = { ...unit, originalText: "The Dice score improved to 99.9%." };
    expect(validateReadingUnit(changed, new Map([[block.blockId, block]])).valid).toBe(false);
  });
});

describe("full-reading coverage", () => {
  const guide = {
    schemaVersion: "1.0", generatedAt: "now", generator: { provider: "test", model: "test", promptVersion: "2" },
    paper: { libraryId: 1, itemKey: "I", attachmentKey: "A", attachmentVersion: 1, title: "Paper", creators: [], year: "", publication: "", doi: "", pageCount: 1, pdfHash: "pdf" },
    preset: { level: "B1", background: "foundation", assistance: "standard" }, overview: "",
    sections: [{ key: "s", title: "S", subtitle: "", units: [{ ...unit, contentKind: "prose" }] }],
    methodFlow: [], metrics: [], criticalReading: [], quiz: [], mode: "full-reading", generationStatus: "complete",
  } satisfies StudyGuide;

  it("requires every source block exactly once", () => {
    expect(validateFullReadingCoverage(guide, [block]).valid).toBe(true);
    const missing = { ...block, blockId: "p0001-b0002" };
    expect(validateFullReadingCoverage(guide, [block, missing]).valid).toBe(false);
  });

  it("rejects translation attached to a formula screenshot", () => {
    const changed: StudyGuide = {
      ...guide,
      sections: [{ ...guide.sections[0]!, units: [{ ...unit, contentKind: "formula", translation: "不应翻译" }] }],
    };
    expect(validateFullReadingCoverage(changed, [block]).valid).toBe(false);
  });
});
