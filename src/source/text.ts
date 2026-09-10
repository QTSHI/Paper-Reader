import type { SourceBlock, SourceSection } from "../domain/types";

const headingPattern = /^(?:\d+(?:\.\d+)*\.?\s+)?(abstract|introduction|related work|materials? and methods?|methodology|methods?|experiments?|results?|discussion|limitations?(?: and future work)?|conclusions?|references)\s*$/i;

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([A-Za-z])-\s*\n\s*([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function sectionKey(title: string): string {
  return normalizeText(title)
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

export function segmentSections(blocks: SourceBlock[]): SourceSection[] {
  const sorted = [...blocks].sort((a, b) => a.pageIndex - b.pageIndex || a.order - b.order);
  const sections: SourceSection[] = [];
  let current: SourceSection = {
    key: "front-matter",
    title: "Front matter",
    pageStart: sorted[0]?.pageIndex ?? 0,
    pageEnd: sorted[0]?.pageIndex ?? 0,
    blocks: [],
  };

  for (const block of sorted) {
    const text = normalizeText(block.text);
    if (headingPattern.test(text)) {
      if (current.blocks.length > 0) sections.push(current);
      current = {
        key: sectionKey(text),
        title: text,
        pageStart: block.pageIndex,
        pageEnd: block.pageIndex,
        blocks: [block],
      };
      continue;
    }
    current.blocks.push(block);
    current.pageEnd = block.pageIndex;
  }

  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

export function extractNumericTokens(value: string): string[] {
  return normalizeText(value).match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?%?/gi) ?? [];
}
