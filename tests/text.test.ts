import { describe, expect, it } from "vitest";
import { extractNumericTokens, normalizeText, segmentSections } from "../src/source/text";
import type { SourceBlock } from "../src/domain/types";

describe("source text", () => {
  it("normalizes whitespace and line-break hyphenation", () => {
    expect(normalizeText("multi-\n modal   image")).toBe("multimodal image");
  });

  it("extracts scientific numeric tokens", () => {
    expect(extractNumericTokens("Dice 91.2%, p=0.03 and 1e-4")).toEqual(["91.2%", "0.03", "1e-4"]);
  });

  it("segments common paper headings", () => {
    const make = (text: string, order: number): SourceBlock => ({ blockId: `b${order}`, pageIndex: 0, order, text, normalizedText: text, hash: "x" });
    const result = segmentSections([make("Abstract", 0), make("Study body", 1), make("1 Introduction", 2), make("Background", 3)]);
    expect(result.map((section) => section.key)).toEqual(["abstract", "introduction"]);
  });
});
