import type { SourceBlock, StudyGuide } from "../domain/types";
import { extractNumericTokens } from "../source/text";
import { validateAnchor, validateReadingUnit } from "./source";

export interface GuideValidationReport {
  valid: boolean;
  checkedUnits: number;
  errors: string[];
}

export interface FullReadingCoverageReport {
  valid: boolean;
  sourceBlocks: number;
  representedBlocks: number;
  errors: string[];
}

export function validateFullReadingCoverage(guide: StudyGuide, blocks: SourceBlock[]): FullReadingCoverageReport {
  if (guide.mode !== "full-reading") {
    return { valid: true, sourceBlocks: blocks.length, representedBlocks: guide.sections.flatMap((section) => section.units).length, errors: [] };
  }
  const sourceIds = new Set(blocks.map((block) => block.blockId));
  const counts = new Map<string, number>();
  const errors: string[] = [];
  const units = guide.sections.flatMap((section) => section.units);
  for (const unit of units) {
    counts.set(unit.source.blockId, (counts.get(unit.source.blockId) ?? 0) + 1);
    if (unit.contentKind === "formula" && unit.translation.trim()) errors.push(`formula ${unit.id}: translation must be empty`);
  }
  for (const id of sourceIds) {
    const count = counts.get(id) ?? 0;
    if (count === 0) errors.push(`source block is missing from full reading: ${id}`);
    if (count > 1) errors.push(`source block occurs more than once: ${id}`);
  }
  for (const id of counts.keys()) if (!sourceIds.has(id)) errors.push(`unknown source block in full reading: ${id}`);
  for (const visual of guide.visuals ?? []) {
    if (!sourceIds.has(visual.sourceBlockId)) errors.push(`visual ${visual.id}: source block does not exist`);
    if (visual.imageDataUrl && !visual.imageDataUrl.startsWith("data:image/")) errors.push(`visual ${visual.id}: image data is invalid`);
    if (!visual.imageDataUrl && !visual.bbox) errors.push(`visual ${visual.id}: lazy crop descriptor is missing`);
  }
  const blockMap = new Map(blocks.map((block) => [block.blockId, block]));
  for (const node of guide.logicGraph?.nodes ?? []) {
    for (const source of node.sources) {
      const result = validateAnchor(source, blockMap);
      errors.push(...result.errors.map((message) => `logic node ${node.id}: ${message}`));
    }
  }
  if (guide.generationStatus !== "complete") errors.push("full reading is not marked complete");
  return { valid: errors.length === 0, sourceBlocks: blocks.length, representedBlocks: units.length, errors };
}

export function discardUntraceableMetrics(guide: StudyGuide, blocks: SourceBlock[]): string[] {
  const blockMap = new Map(blocks.map((block) => [block.blockId, block]));
  const removed: string[] = [];
  guide.metrics = guide.metrics.filter((metric) => {
    const anchor = validateAnchor(metric.source, blockMap);
    const sourceNumbers = new Set(extractNumericTokens(metric.source.quote));
    const numbersValid = extractNumericTokens(metric.value).every((token) => sourceNumbers.has(token));
    const keep = anchor.valid && numbersValid;
    if (!keep) removed.push(metric.label);
    return keep;
  });
  return removed;
}

export function validateGuideSources(guide: StudyGuide, blocks: SourceBlock[]): GuideValidationReport {
  const blockMap = new Map(blocks.map((block) => [block.blockId, block]));
  const errors: string[] = [];
  let checkedUnits = 0;

  for (const section of guide.sections) {
    for (const unit of section.units) {
      checkedUnits += 1;
      const result = validateReadingUnit(unit, blockMap);
      unit.validationStatus = result.valid ? "valid" : "needs_review";
      errors.push(...result.errors.map((message) => `${unit.id}: ${message}`));
    }
  }

  for (const metric of guide.metrics) {
    const result = validateAnchor(metric.source, blockMap);
    errors.push(...result.errors.map((message) => `metric ${metric.label}: ${message}`));
    const sourceNumbers = new Set(extractNumericTokens(metric.source.quote));
    for (const token of extractNumericTokens(metric.value)) {
      if (!sourceNumbers.has(token)) errors.push(`metric ${metric.label}: numeric token is absent from source: ${token}`);
    }
  }
  for (const quiz of guide.quiz) {
    const result = validateAnchor(quiz.source, blockMap);
    errors.push(...result.errors.map((message) => `quiz ${quiz.id}: ${message}`));
  }
  for (const prompt of guide.criticalReading) {
    for (const source of prompt.sources) {
      const result = validateAnchor(source, blockMap);
      errors.push(...result.errors.map((message) => `critical reading ${prompt.title}: ${message}`));
    }
  }

  return { valid: errors.length === 0, checkedUnits, errors };
}
