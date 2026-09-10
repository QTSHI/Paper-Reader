import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractPdf } from "../src/source/pdf";

const samplePath = process.env.PAPER_READER_TEST_PDF;

describe.skipIf(!samplePath)("real PDF extraction", () => {
  it("extracts traceable blocks and sections", async () => {
    const bytes = new Uint8Array(await readFile(samplePath!));
    const document = await extractPdf(bytes);
    expect(document.pageCount).toBeGreaterThan(0);
    expect(document.blocks.length).toBeGreaterThan(document.pageCount);
    expect(document.sections.length).toBeGreaterThan(0);
    expect(document.blocks.every((block) => block.hash.length === 64)).toBe(true);
  }, 60_000);
});
