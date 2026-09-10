import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createDeepSeekGuide } from "../src/generation/deepseek";
import { extractPdf } from "../src/source/pdf";
import { discardUntraceableMetrics, validateGuideSources } from "../src/validation/guide";
import type { PaperRef } from "../src/domain/types";

const execFileAsync = promisify(execFile);
const pdfPath = process.env.PAPER_READER_TEST_PDF;
if (!pdfPath) throw new Error("Set PAPER_READER_TEST_PDF to a readable PDF path");

const document = await extractPdf(new Uint8Array(await readFile(pdfPath)));

(globalThis as any).Zotero = {
  logError: (error: unknown) => process.stderr.write(`${String(error)}\n`),
  Utilities: {
    Internal: {
      subprocess: async (command: string, args: string[]) => (await execFileAsync(command, args)).stdout,
    },
  },
  HTTP: {
    request: async (_method: string, url: string, options: any) => {
      const response = await fetch(url, { method: "POST", headers: options.headers, body: options.body });
      const responseJSON = await response.json();
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${JSON.stringify(responseJSON)}`);
      return { responseJSON, responseText: JSON.stringify(responseJSON) };
    },
  },
};

const paper: PaperRef = {
  libraryId: 1, itemKey: "SMOKE", attachmentKey: "SMOKE-PDF", attachmentVersion: 1,
  title: "STADNet: Spatial-Temporal Attention-Guided Dual-Path Network",
  creators: [], year: "2024", publication: "", doi: "",
  pageCount: document.pageCount, pdfHash: document.pdfHash,
};
const guide = await createDeepSeekGuide(
  paper,
  document,
  { level: "B1", background: "foundation", assistance: "standard" },
);
const removedMetrics = discardUntraceableMetrics(guide, document.blocks);
const validation = validateGuideSources(guide, document.blocks);
process.stdout.write(`${JSON.stringify({
  model: guide.generator.model,
  pages: document.pageCount,
  sections: guide.sections.length,
  units: guide.sections.reduce((sum, section) => sum + section.units.length, 0),
  metrics: guide.metrics.length,
  removedMetrics,
  criticalPrompts: guide.criticalReading.length,
  quiz: guide.quiz.length,
  sourceValidation: validation.valid,
  validationErrors: validation.errors.slice(0, 5),
}, null, 2)}\n`);
