import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PaperVisual, SourceBlock, SourceSection } from "../domain/types";
import { normalizeText, segmentSections } from "./text";

export interface ExtractedDocument {
  pageCount: number;
  pdfHash: string;
  blocks: SourceBlock[];
  sections: SourceSection[];
  visuals: PaperVisual[];
}

interface Line {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function toLines(items: TextItem[], pageWidth: number): Line[] {
  const positioned = items
    .filter((item) => normalizeText(item.str).length > 0)
    .map((item) => ({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width,
      height: Math.max(item.height, Math.abs(item.transform[3] ?? 0), 1),
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);

  const lines: Array<Omit<Line, "column">> = [];
  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.2);
    if (!line) {
      lines.push({ ...item });
      continue;
    }
    const gap = item.x - (line.x + line.width);
    line.text += gap > line.height * 0.3 ? ` ${item.text}` : item.text;
    line.width = Math.max(line.width, item.x + item.width - line.x);
    line.height = Math.max(line.height, item.height);
  }

  const mid = pageWidth / 2;
  const leftCount = lines.filter((line) => line.x < mid * 0.92 && line.x + line.width < mid * 1.08).length;
  const rightCount = lines.filter((line) => line.x >= mid * 0.85).length;
  const isTwoColumn = leftCount >= 5 && rightCount >= 5;
  return lines
    .map((line) => ({ ...line, column: isTwoColumn && line.x >= mid * 0.85 ? 1 : 0 }))
    .sort((a, b) => a.column - b.column || b.y - a.y || a.x - b.x);
}

async function linesToBlocks(lines: Line[], pageIndex: number): Promise<SourceBlock[]> {
  const paragraphs: Array<{ text: string; lines: Line[] }> = [];
  for (const line of lines) {
    const previous = paragraphs.at(-1);
    const previousLine = previous?.lines.at(-1);
    const verticalGap = previousLine ? previousLine.y - line.y : Number.POSITIVE_INFINITY;
    const sameColumn = previousLine?.column === line.column;
    const headingLike = /^(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][A-Za-z ]{2,40}$/.test(normalizeText(line.text));
    const shouldJoin = Boolean(
      previous &&
      previousLine &&
      sameColumn &&
      verticalGap >= 0 &&
      verticalGap <= Math.max(previousLine.height, line.height) * 1.8 &&
      previous.text.length < 1400 &&
      !headingLike,
    );
    if (shouldJoin && previous) {
      previous.text += previous.text.endsWith("-") ? line.text : ` ${line.text}`;
      previous.lines.push(line);
    } else {
      paragraphs.push({ text: line.text, lines: [line] });
    }
  }

  return Promise.all(paragraphs.map(async (paragraph, order) => {
    const text = normalizeText(paragraph.text);
    const x0 = Math.min(...paragraph.lines.map((line) => line.x));
    const y0 = Math.min(...paragraph.lines.map((line) => line.y));
    const x1 = Math.max(...paragraph.lines.map((line) => line.x + line.width));
    const y1 = Math.max(...paragraph.lines.map((line) => line.y + line.height));
    return {
      blockId: `p${String(pageIndex + 1).padStart(4, "0")}-b${String(order + 1).padStart(4, "0")}`,
      pageIndex,
      order,
      text,
      normalizedText: text,
      hash: await sha256(text),
      bbox: [x0, y0, x1, y1],
    };
  }));
}

export function classifyVisualKind(text: string): PaperVisual["kind"] | null {
  if (/^(?:fig(?:ure)?\.?\s*\d+[.:]?)/i.test(text)) return "figure";
  if (/^table\s*\d+[.:]?/i.test(text)) return "table";
  if (text.length <= 520) {
    const symbols = text.match(/[=∑∏√∫±×÷≤≥≠≈∈∂λμστωαβγδθ]|\b(?:arg|min|max|exp|log|sin|cos)\b/g) ?? [];
    const equationNumber = /\(\s*\d{1,2}\s*\)\s*$/.test(text);
    if (symbols.length >= 2 || (symbols.length >= 1 && equationNumber)) return "formula";
  }
  return null;
}

async function renderPage(page: any): Promise<{ canvas: HTMLCanvasElement; viewport: any } | null> {
  if (typeof document === "undefined") return null;
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  const renderTask = page.render({ canvas, canvasContext: context, viewport } as any);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      renderTask.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("PDF page render timed out")), 4000);
      }),
    ]);
    return { canvas, viewport };
  } catch (error) {
    try { renderTask.cancel(); } catch (_) { /* best-effort cancellation */ }
    if (typeof Services !== "undefined") {
      Services.console.logStringMessage(`[Paper Reading Assistant] visual rendering skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function cropVisual(rendered: { canvas: HTMLCanvasElement; viewport: any }, block: SourceBlock, kind: PaperVisual["kind"]): string {
  if (!block.bbox || typeof document === "undefined") return "";
  const { canvas, viewport: renderedViewport } = rendered;
  const [x0, y0, x1, y1] = block.bbox;
  const first = renderedViewport.convertToViewportPoint(x0, y0);
  const second = renderedViewport.convertToViewportPoint(x1, y1);
  let left = Math.min(first[0], second[0]) - 14;
  let right = Math.max(first[0], second[0]) + 14;
  let top = Math.min(first[1], second[1]) - 12;
  let bottom = Math.max(first[1], second[1]) + 12;
  if (kind === "figure") {
    left = renderedViewport.width * 0.04;
    right = renderedViewport.width * 0.96;
    top = Math.max(0, top - renderedViewport.height * 0.43);
  } else if (kind === "table") {
    left = renderedViewport.width * 0.04;
    right = renderedViewport.width * 0.96;
    bottom = Math.min(renderedViewport.height, bottom + renderedViewport.height * 0.43);
  }
  left = Math.max(0, Math.floor(left));
  top = Math.max(0, Math.floor(top));
  right = Math.min(canvas.width, Math.ceil(right));
  bottom = Math.min(canvas.height, Math.ceil(bottom));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  crop.getContext("2d")?.drawImage(canvas, left, top, width, height, 0, 0, width, height);
  return crop.toDataURL(kind === "formula" ? "image/png" : "image/jpeg", 0.84);
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  if (typeof Zotero !== "undefined") {
    GlobalWorkerOptions.workerSrc = "chrome://paper-reader/content/pdf.worker.mjs";
  }
  // PDF.js may transfer and detach the provided buffer, so hash first and pass a copy.
  const pdfHash = await sha256(bytes);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const pdf = await task.promise;
  const pageCount = pdf.numPages;
  const blocks: SourceBlock[] = [];
  const visuals: PaperVisual[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (typeof Services !== "undefined") {
        Services.console.logStringMessage(`[Paper Reading Assistant] parsing PDF page ${pageNumber}/${pdf.numPages}`);
      }
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((item) => "str" in item).map((item) => item as TextItem);
      const pageBlocks = await linesToBlocks(toLines(items, viewport.width), pageNumber - 1);
      blocks.push(...pageBlocks);
      const candidates = pageBlocks.map((block) => ({ block, kind: classifyVisualKind(block.text) }))
        .filter((entry): entry is { block: SourceBlock; kind: PaperVisual["kind"] } => Boolean(entry.kind))
        .filter((entry) => visuals.filter((visual) => visual.kind === entry.kind).length < (entry.kind === "formula" ? 24 : 14));
      // Zotero's background chrome document can stall while PDF.js paints to a
      // detached canvas. Preserve crop descriptors here and render them later in
      // the visible reading window; non-Zotero consumers may still render now.
      const rendered = candidates.length && typeof Zotero === "undefined" ? await renderPage(page) : null;
      for (const { block, kind } of candidates) {
        if (visuals.filter((entry) => entry.kind === kind).length >= (kind === "formula" ? 24 : 14)) continue;
        const imageDataUrl = rendered ? cropVisual(rendered, block, kind) : "";
        visuals.push({
          id: `visual-${block.blockId}`, kind, pageIndex: block.pageIndex,
          caption: kind === "formula" ? `公式区域 · 第 ${pageNumber} 页` : block.text,
          imageDataUrl, sourceBlockId: block.blockId,
          ...(block.bbox ? { bbox: block.bbox } : {}),
        });
      }
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  return {
    pageCount,
    pdfHash,
    blocks,
    sections: segmentSections(blocks),
    visuals,
  };
}
