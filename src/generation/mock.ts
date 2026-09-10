import type { ExtractedDocument } from "../source/pdf";
import type { GuideSection, PaperRef, ReaderPreset, ReadingUnit, SourceBlock, StudyGuide } from "../domain/types";

function sourceFor(paper: PaperRef, block: SourceBlock) {
  return {
    attachmentKey: paper.attachmentKey,
    pageIndex: block.pageIndex,
    blockId: block.blockId,
    quote: block.text,
    normalizedQuote: block.normalizedText,
    blockHash: block.hash,
    ...(block.bbox ? { bbox: block.bbox } : {}),
  };
}

function unitFor(paper: PaperRef, block: SourceBlock, index: number): ReadingUnit {
  return {
    id: `unit-${block.blockId}`,
    label: `Original ${String(index + 1).padStart(2, "0")}`,
    purpose: "Mock 内容预览",
    originalText: block.text,
    translation: "Mock 模式：配置模型与 API Key 后，这里将生成面向当前阅读水平的中文解释。",
    source: sourceFor(paper, block),
    vocabulary: [],
    logic: [{ label: "状态", explanation: "来源定位已经建立；语言分析等待真实模型生成。" }],
    validationStatus: "valid",
  };
}

export function createMockGuide(paper: PaperRef, document: ExtractedDocument, preset: ReaderPreset): StudyGuide {
  let unitIndex = 0;
  const candidates = document.sections
    .filter((section) => section.blocks.some((block) => block.text.length >= 80))
    .slice(0, 6);
  const sections: GuideSection[] = candidates.map((section) => {
    const units = section.blocks
      .filter((block) => block.text.length >= 80)
      .slice(0, 2)
      .map((block) => unitFor(paper, block, unitIndex++));
    return { key: section.key, title: section.title, subtitle: "先读英文，再核对解释", units };
  }).filter((section) => section.units.length > 0);

  const firstUnit = sections[0]?.units[0];
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    generator: { provider: "mock", model: "local-preview", promptVersion: "1.0" },
    paper,
    preset,
    overview: "这是由真实 Zotero 条目和 PDF 页级文本生成的 Mock 精读页。原文和出处可用；翻译、术语、方法、结果与小测将在 API 联调后生成。",
    sections,
    methodFlow: [
      { label: "Zotero PDF", explanation: "读取当前论文附件" },
      { label: "Source anchors", explanation: "建立页码与文本块定位" },
      { label: "Guided reading", explanation: "生成并校验精读内容" },
    ],
    metrics: [],
    criticalReading: [],
    quiz: firstUnit ? [{
      id: "mock-check",
      question: "当前页面中的英文原文来自哪里？",
      options: ["模型自由生成", "当前 Zotero PDF", "互联网搜索"],
      answerIndex: 1,
      explanation: "Mock 页面中的原文由插件从当前 Zotero PDF 按页提取。",
      source: firstUnit.source,
    }] : [],
  };
}
