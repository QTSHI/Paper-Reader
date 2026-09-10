import type { ReadingUnit, SourceAnchor, SourceBlock } from "../domain/types";
import { extractNumericTokens, normalizeText } from "../source/text";

export interface SourceValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAnchor(anchor: SourceAnchor, blocks: Map<string, SourceBlock>): SourceValidationResult {
  const errors: string[] = [];
  const block = blocks.get(anchor.blockId);
  if (!block) return { valid: false, errors: [`Unknown source block: ${anchor.blockId}`] };
  if (anchor.pageIndex !== block.pageIndex) errors.push("Source page does not match the referenced block");
  if (!block.normalizedText.includes(normalizeText(anchor.quote))) errors.push("Source quote does not occur in the referenced block");
  if (normalizeText(anchor.quote) !== anchor.normalizedQuote) errors.push("Normalized source quote is inconsistent");
  if (anchor.blockHash !== block.hash) errors.push("Source block hash has changed");
  return { valid: errors.length === 0, errors };
}

export function validateReadingUnit(unit: ReadingUnit, blocks: Map<string, SourceBlock>): SourceValidationResult {
  const errors: string[] = [];
  const block = blocks.get(unit.source.blockId);
  if (!block) {
    return { valid: false, errors: [`Unknown source block: ${unit.source.blockId}`] };
  }

  errors.push(...validateAnchor(unit.source, blocks).errors);
  const normalizedQuote = normalizeText(unit.originalText);
  if (!block.normalizedText.includes(normalizedQuote)) {
    errors.push("Original quote does not occur in the referenced source block");
  }

  if (normalizedQuote !== unit.source.normalizedQuote) errors.push("Displayed original differs from the source quote");

  const sourceNumbers = new Set(extractNumericTokens(block.text));
  for (const token of extractNumericTokens(unit.originalText)) {
    if (!sourceNumbers.has(token)) errors.push(`Numeric token is absent from source: ${token}`);
  }

  return { valid: errors.length === 0, errors };
}
