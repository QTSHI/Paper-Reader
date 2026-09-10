import Ajv from "ajv";
import { jsonrepair } from "jsonrepair";
import type {
  CriticalPrompt, GuideSection, LogicGraph, MetricItem, PaperRef, QuizItem,
  ReaderPreset, ReadingContentKind, ReadingUnit, SourceAnchor, SourceBlock, StudyGuide,
} from "../domain/types";
import type { ExtractedDocument } from "../source/pdf";
import { readDeepSeekApiKey } from "../security/keychain";

const ENDPOINT = "https://api.deepseek.com/responses";
const MODEL = "deepseek-v4-flash";

interface DraftUnit {
  id: string;
  label: string;
  purpose: string;
  sourceBlockId: string;
  translation: string;
  vocabulary: Array<{ word: string; partOfSpeech: string; meaning: string; usage: string }>;
  logic: Array<{ label: string; explanation: string }>;
}

interface DraftGuide {
  overview: string;
  sections: Array<{ key: string; title: string; subtitle: string; units: DraftUnit[] }>;
  methodFlow: Array<{ label: string; explanation: string }>;
  metrics: Array<{ label: string; value: string; explanation: string; sourceBlockId: string }>;
  criticalReading: Array<{ title: string; commentary: string; sourceBlockIds: string[] }>;
  quiz: Array<{ id: string; question: string; options: string[]; answerIndex: number; explanation: string; sourceBlockId: string }>;
}

const vocabularySchema = {
  type: "object", additionalProperties: false,
  required: ["word", "partOfSpeech", "meaning", "usage"],
  properties: {
    word: { type: "string" }, partOfSpeech: { type: "string" },
    meaning: { type: "string" }, usage: { type: "string" },
  },
} as const;

export const draftGuideSchema = {
  type: "object", additionalProperties: false,
  required: ["overview", "sections", "methodFlow", "metrics", "criticalReading", "quiz"],
  properties: {
    overview: { type: "string" },
    sections: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "title", "subtitle", "units"],
        properties: {
          key: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" },
          units: {
            type: "array", minItems: 1,
            items: {
              type: "object", additionalProperties: false,
              required: ["id", "label", "purpose", "sourceBlockId", "translation", "vocabulary", "logic"],
              properties: {
                id: { type: "string" }, label: { type: "string" }, purpose: { type: "string" },
                sourceBlockId: { type: "string" }, translation: { type: "string" },
                vocabulary: { type: "array", items: vocabularySchema },
                logic: {
                  type: "array", items: {
                    type: "object", additionalProperties: false, required: ["label", "explanation"],
                    properties: { label: { type: "string" }, explanation: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    methodFlow: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["label", "explanation"],
        properties: { label: { type: "string" }, explanation: { type: "string" } },
      },
    },
    metrics: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["label", "value", "explanation", "sourceBlockId"],
        properties: {
          label: { type: "string" }, value: { type: "string" },
          explanation: { type: "string" }, sourceBlockId: { type: "string" },
        },
      },
    },
    criticalReading: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["title", "commentary", "sourceBlockIds"],
        properties: {
          title: { type: "string" }, commentary: { type: "string" },
          sourceBlockIds: { type: "array", minItems: 1, items: { type: "string" } },
        },
      },
    },
    quiz: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["id", "question", "options", "answerIndex", "explanation", "sourceBlockId"],
        properties: {
          id: { type: "string" }, question: { type: "string" },
          options: { type: "array", minItems: 2, items: { type: "string" } },
          answerIndex: { type: "integer", minimum: 0 }, explanation: { type: "string" },
          sourceBlockId: { type: "string" },
        },
      },
    },
  },
} as const;

const validateDraft = new Ajv({ allErrors: true, strict: true }).compile(draftGuideSchema);

function outputText(payload: any): string {
  for (const item of payload?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error(payload?.error?.message || "DeepSeek 未返回可用内容");
}

export function parseModelJSON(value: string): unknown {
  const trimmed = value.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let inString = false;
  let escaped = false;
  let sanitized = "";
  for (const character of withoutFence) {
    if (escaped) {
      sanitized += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      sanitized += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      sanitized += character;
      continue;
    }
    const code = character.charCodeAt(0);
    if (inString && code <= 0x1f) {
      sanitized += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    sanitized += character;
  }
  try {
    return JSON.parse(sanitized);
  } catch (_) {
    return JSON.parse(jsonrepair(sanitized));
  }
}

function sourceFor(paper: PaperRef, block: SourceBlock): SourceAnchor {
  return {
    attachmentKey: paper.attachmentKey, pageIndex: block.pageIndex,
    blockId: block.blockId, quote: block.text, normalizedQuote: block.normalizedText,
    blockHash: block.hash, ...(block.bbox ? { bbox: block.bbox } : {}),
  };
}

function hydrateDraft(draft: DraftGuide, paper: PaperRef, preset: ReaderPreset, blocks: SourceBlock[]): StudyGuide {
  const byId = new Map(blocks.map((block) => [block.blockId, block]));
  const getBlock = (id: string): SourceBlock => {
    const block = byId.get(id);
    if (!block) throw new Error(`模型引用了不存在的原文块：${id}`);
    return block;
  };
  const sections: GuideSection[] = draft.sections.map((section) => ({
    ...section,
    units: section.units.map((unit): ReadingUnit => {
      const block = getBlock(unit.sourceBlockId);
      return {
        id: unit.id, label: unit.label, purpose: unit.purpose,
        originalText: block.text, translation: unit.translation,
        source: sourceFor(paper, block), vocabulary: unit.vocabulary,
        logic: unit.logic, validationStatus: "valid",
      };
    }),
  }));
  const metrics: MetricItem[] = draft.metrics.map((metric) => {
    const block = getBlock(metric.sourceBlockId);
    return {
      label: metric.label, value: metric.value, explanation: metric.explanation,
      source: sourceFor(paper, block),
    };
  });
  const criticalReading: CriticalPrompt[] = draft.criticalReading.map((entry) => ({
    title: entry.title, commentary: entry.commentary,
    sources: entry.sourceBlockIds.map((id) => sourceFor(paper, getBlock(id))),
  }));
  const quiz: QuizItem[] = draft.quiz.map((entry) => {
    if (entry.answerIndex >= entry.options.length) throw new Error(`测验答案越界：${entry.id}`);
    return {
      id: entry.id, question: entry.question, options: entry.options,
      answerIndex: entry.answerIndex, explanation: entry.explanation,
      source: sourceFor(paper, getBlock(entry.sourceBlockId)),
    };
  });
  return {
    schemaVersion: "1.0", generatedAt: new Date().toISOString(),
    generator: { provider: "deepseek", model: MODEL, promptVersion: "1.0" },
    paper, preset, overview: draft.overview, sections,
    methodFlow: draft.methodFlow, metrics, criticalReading, quiz,
  };
}

interface FullUnitDraft {
  sourceBlockId: string;
  label: string;
  purpose: string;
  translation: string;
  vocabulary: Array<{ word: string; partOfSpeech: string; meaning: string; usage: string }>;
  logic: Array<{ label: string; explanation: string }>;
}

interface SynthesisDraft {
  overview: string;
  methodFlow: Array<{ label: string; explanation: string }>;
  metrics: Array<{ label: string; value: string; explanation: string; sourceBlockId: string }>;
  criticalReading: Array<{ title: string; commentary: string; sourceBlockIds: string[] }>;
  quiz: Array<{ id: string; question: string; options: string[]; answerIndex: number; explanation: string; sourceBlockId: string }>;
  logicGraph: {
    title: string;
    nodes: Array<{
      id: string;
      kind: "background" | "gap" | "objective" | "method" | "experiment" | "result" | "conclusion" | "limitation";
      label: string;
      explanation: string;
      sourceBlockIds: string[];
    }>;
    edges: Array<{ from: string; to: string; label: string }>;
  };
}

export interface FullReadingHooks {
  onProgress?: (completed: number, total: number, label: string) => void;
  onCheckpoint?: (guide: StudyGuide) => Promise<void>;
}

const unitBatchSchema = {
  type: "object", additionalProperties: false, required: ["units"],
  properties: {
    units: { type: "array", minItems: 1, items: {
      type: "object", additionalProperties: false,
      required: ["sourceBlockId", "label", "purpose", "translation", "vocabulary", "logic"],
      properties: {
        sourceBlockId: { type: "string" }, label: { type: "string" }, purpose: { type: "string" },
        translation: { type: "string" }, vocabulary: { type: "array", items: vocabularySchema },
        logic: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["label", "explanation"],
          properties: { label: { type: "string" }, explanation: { type: "string" } },
        } },
      },
    } },
  },
} as const;

const synthesisSchema = {
  type: "object", additionalProperties: false,
  required: ["overview", "methodFlow", "metrics", "criticalReading", "quiz", "logicGraph"],
  properties: {
    overview: { type: "string" },
    methodFlow: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["label", "explanation"],
      properties: { label: { type: "string" }, explanation: { type: "string" } },
    } },
    metrics: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["label", "value", "explanation", "sourceBlockId"],
      properties: { label: { type: "string" }, value: { type: "string" }, explanation: { type: "string" }, sourceBlockId: { type: "string" } },
    } },
    criticalReading: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["title", "commentary", "sourceBlockIds"],
      properties: { title: { type: "string" }, commentary: { type: "string" }, sourceBlockIds: { type: "array", items: { type: "string" } } },
    } },
    quiz: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["id", "question", "options", "answerIndex", "explanation", "sourceBlockId"],
      properties: {
        id: { type: "string" }, question: { type: "string" }, options: { type: "array", minItems: 2, items: { type: "string" } },
        answerIndex: { type: "integer", minimum: 0 }, explanation: { type: "string" }, sourceBlockId: { type: "string" },
      },
    } },
    logicGraph: { type: "object", additionalProperties: false, required: ["title", "nodes", "edges"], properties: {
      title: { type: "string" },
      nodes: { type: "array", minItems: 3, items: {
        type: "object", additionalProperties: false, required: ["id", "kind", "label", "explanation", "sourceBlockIds"],
        properties: {
          id: { type: "string" }, kind: { enum: ["background", "gap", "objective", "method", "experiment", "result", "conclusion", "limitation"] },
          label: { type: "string" }, explanation: { type: "string" }, sourceBlockIds: { type: "array", minItems: 1, items: { type: "string" } },
        },
      } },
      edges: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["from", "to", "label"],
        properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
      } },
    } },
  },
} as const;

const validateUnitBatch = new Ajv({ allErrors: true, strict: false }).compile(unitBatchSchema);
const validateSynthesis = new Ajv({ allErrors: true, strict: false }).compile(synthesisSchema);

async function requestStructured<T>(apiKey: string, name: string, schema: Record<string, unknown>, instructions: string, input: unknown, maxOutputTokens: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, store: false,
          instructions: attempt === 0 ? instructions : `${instructions}\n必须返回一个完整且可解析的 JSON 对象；字符串中的引号必须正确转义。`,
          input: JSON.stringify(input), reasoning: { effort: "none" }, max_output_tokens: maxOutputTokens,
          text: { format: { type: "json_schema", name, schema } },
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}：${payload?.error?.message || "请求失败"}`);
      try {
        return parseModelJSON(outputText(payload)) as T;
      } catch (error) {
        lastError = error;
      }
    } catch (error) {
      if (controller.signal.aborted) lastError = new Error("DeepSeek 请求超过 120 秒，请重试");
      else lastError = error;
      if (error instanceof Error && /^DeepSeek HTTP 4\d\d/.test(error.message)) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`DeepSeek 返回内容无法解析：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function readingKind(sectionKey: string, block: SourceBlock, document: ExtractedDocument): ReadingContentKind {
  const visual = document.visuals.find((entry) => entry.sourceBlockId === block.blockId);
  if (visual?.kind === "formula") return "formula";
  if (visual) return "caption";
  if (sectionKey === "references") return "reference";
  if (sectionKey === "front-matter" && block.pageIndex <= 1 && block.text.length < 90) return "metadata";
  return "prose";
}

function splitBatches(blocks: SourceBlock[], maxCharacters = 4500): SourceBlock[][] {
  const result: SourceBlock[][] = [];
  let current: SourceBlock[] = [];
  let size = 0;
  for (const block of blocks) {
    if (current.length && (size + block.text.length > maxCharacters || current.length >= 6)) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.text.length;
  }
  if (current.length) result.push(current);
  return result;
}

function defaultUnit(paper: PaperRef, block: SourceBlock, kind: ReadingContentKind, visualId?: string): ReadingUnit {
  return {
    id: `unit-${block.blockId}`, label: kind === "formula" ? "数学公式" : kind === "reference" ? "参考文献" : kind === "caption" ? "论文图表" : "原文",
    purpose: kind === "formula" ? "公式按原貌保留，不进行机器翻译" : kind === "reference" ? "全文保留，默认折叠" : "全文通读",
    originalText: block.text, translation: "", source: sourceFor(paper, block), vocabulary: [], logic: [],
    validationStatus: "valid", contentKind: kind, ...(visualId ? { visualId } : {}),
  };
}

function buildSections(paper: PaperRef, document: ExtractedDocument, translated: Map<string, FullUnitDraft>): GuideSection[] {
  const visualByBlock = new Map(document.visuals.map((entry) => [entry.sourceBlockId, entry]));
  return document.sections.map((section) => ({
    key: section.key, title: section.title, subtitle: `第 ${section.pageStart + 1}–${section.pageEnd + 1} 页 · 全文保留`,
    units: section.blocks.map((block) => {
      const kind = readingKind(section.key, block, document);
      const draft = translated.get(block.blockId);
      const unit = defaultUnit(paper, block, kind, visualByBlock.get(block.blockId)?.id);
      if (draft && (kind === "prose" || kind === "caption")) {
        unit.label = draft.label;
        unit.purpose = draft.purpose;
        unit.translation = draft.translation;
        unit.vocabulary = draft.vocabulary;
        unit.logic = draft.logic;
      }
      return unit;
    }),
  })).filter((section) => section.units.length > 0);
}

function emptyGuide(paper: PaperRef, preset: ReaderPreset, document: ExtractedDocument, sections: GuideSection[], completedBlocks: number): StudyGuide {
  return {
    schemaVersion: "1.0", generatedAt: new Date().toISOString(),
    generator: { provider: "deepseek", model: MODEL, promptVersion: "2.0-full-reading" },
    paper, preset, overview: "全文通读内容正在分章生成。", sections,
    methodFlow: [], metrics: [], criticalReading: [], quiz: [], mode: "full-reading",
    generationStatus: "partial", completedBlocks, totalBlocks: document.blocks.length,
    visuals: document.visuals, logicGraph: { title: "论文逻辑线路", nodes: [], edges: [] },
  };
}

export async function createDeepSeekGuide(
  paper: PaperRef,
  document: ExtractedDocument,
  preset: ReaderPreset,
  hooks: FullReadingHooks = {},
): Promise<StudyGuide> {
  const blocks = document.sections.flatMap((section) => section.blocks);
  if (!blocks.length) throw new Error("PDF 中没有足够的可读文本");
  const apiKey = await readDeepSeekApiKey();
  const proseBlocks = blocks.filter((block) => {
    const section = document.sections.find((entry) => entry.blocks.some((item) => item.blockId === block.blockId));
    const kind = section ? readingKind(section.key, block, document) : "metadata";
    return section && (kind === "prose" || kind === "caption") && block.text.length >= 12;
  });
  const batches = splitBatches(proseBlocks);
  const translated = new Map<string, FullUnitDraft>();
  for (const [index, batch] of batches.entries()) {
    hooks.onProgress?.(index, batches.length + 1, `翻译与解析第 ${index + 1}/${batches.length} 批正文`);
    const raw = await requestStructured<{ units: FullUnitDraft[] }>(
      apiKey, "full_reading_units", unitBatchSchema as unknown as Record<string, unknown>,
      [
        "你是医学影像英文论文通读助手。逐一处理输入的每个 sourceBlock，不得挑选、合并、遗漏或改写英文原文。",
        "只输出辅助字段：忠实中文翻译、简短阅读目的、少量真正有学习价值的术语、以及必要的长句或论证关系。",
        "sourceBlockId 必须原样返回。不要解释数学公式；公式已由程序作为图片处理。面向 CEFR B1-B2。",
      ].join("\n"),
      { paper: paper.title, reader: preset, sourceBlocks: batch.map((block) => ({ sourceBlockId: block.blockId, page: block.pageIndex + 1, text: block.text })) },
      Math.min(8000, 1600 + batch.reduce((sum, block) => sum + block.text.length, 0)),
    );
    if (!validateUnitBatch(raw)) throw new Error(`正文批次 ${index + 1} 返回结构不合格`);
    for (const unit of raw.units) if (batch.some((block) => block.blockId === unit.sourceBlockId)) translated.set(unit.sourceBlockId, unit);
    const sections = buildSections(paper, document, translated);
    await hooks.onCheckpoint?.(emptyGuide(paper, preset, document, sections, translated.size));
  }

  hooks.onProgress?.(batches.length, batches.length + 1, "生成论文总结与逻辑线路图");
  const synthesisBlocks = blocks.filter((block) => {
    const section = document.sections.find((entry) => entry.blocks.some((item) => item.blockId === block.blockId));
    return section?.key !== "references" && block.text.length >= 20;
  });
  const synthesis = await requestStructured<SynthesisDraft>(
    apiKey, "full_reading_synthesis", synthesisSchema as unknown as Record<string, unknown>,
    [
      "只依据给定的医学影像论文原文生成全篇通读总结。所有来源 ID 必须来自输入。",
      "metrics 的 value 必须逐字出现在对应来源块中，不得计算或改写数字。",
      "logicGraph 建立背景→研究空白→目标→方法→实验→结果→结论/局限的论文逻辑线路；节点必须有原文来源，边只能连接已有节点。",
      "批判性阅读明确标为编辑分析，不冒充作者结论。生成 3-5 道小测。",
    ].join("\n"),
    { paper: paper.title, sourceBlocks: synthesisBlocks.map((block) => ({ sourceBlockId: block.blockId, page: block.pageIndex + 1, text: block.text })) },
    9000,
  );
  if (!validateSynthesis(synthesis)) throw new Error("论文总结返回结构不合格");
  const byId = new Map(blocks.map((block) => [block.blockId, block]));
  const getBlock = (id: string) => {
    const block = byId.get(id);
    if (!block) throw new Error(`总结引用了不存在的原文块：${id}`);
    return block;
  };
  const metrics: MetricItem[] = synthesis.metrics.map((entry) => ({
    label: entry.label, value: entry.value, explanation: entry.explanation, source: sourceFor(paper, getBlock(entry.sourceBlockId)),
  }));
  const criticalReading: CriticalPrompt[] = synthesis.criticalReading.map((entry) => ({
    title: entry.title, commentary: entry.commentary, sources: entry.sourceBlockIds.map((id) => sourceFor(paper, getBlock(id))),
  }));
  const quiz: QuizItem[] = synthesis.quiz.map((entry) => ({
    id: entry.id, question: entry.question, options: entry.options,
    answerIndex: Math.min(entry.answerIndex, entry.options.length - 1), explanation: entry.explanation,
    source: sourceFor(paper, getBlock(entry.sourceBlockId)),
  }));
  const nodeIds = new Set(synthesis.logicGraph.nodes.map((node) => node.id));
  const logicGraph: LogicGraph = {
    title: synthesis.logicGraph.title,
    nodes: synthesis.logicGraph.nodes.map((node) => ({
      id: node.id, kind: node.kind, label: node.label, explanation: node.explanation,
      sources: node.sourceBlockIds.map((id) => sourceFor(paper, getBlock(id))),
    })),
    edges: synthesis.logicGraph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
  };
  return {
    schemaVersion: "1.0", generatedAt: new Date().toISOString(),
    generator: { provider: "deepseek", model: MODEL, promptVersion: "2.0-full-reading" },
    paper, preset, overview: synthesis.overview, sections: buildSections(paper, document, translated),
    methodFlow: synthesis.methodFlow, metrics, criticalReading, quiz,
    mode: "full-reading", generationStatus: "complete", completedBlocks: blocks.length, totalBlocks: blocks.length,
    visuals: document.visuals, logicGraph,
  };
}
