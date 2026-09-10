import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PaperVisual, QuizItem, SourceAnchor, StudyGuide, VocabularyEntry } from "../domain/types";

interface ReaderPayload {
  guide: StudyGuide;
  openSource: (anchor: SourceAnchor) => Promise<void>;
  getPdfBytes?: () => Promise<Uint8Array>;
  saveGuide?: (guide: StudyGuide) => Promise<void>;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function navigationLink(label: string, target: HTMLElement): HTMLAnchorElement {
  const link = element("a", "", label);
  link.href = `#${target.id}`;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelectorAll<HTMLAnchorElement>("#rail a").forEach((item) => {
      const active = item === link;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "location");
      else item.removeAttribute("aria-current");
    });
  });
  return link;
}

function sourceButton(payload: ReaderPayload, source: SourceAnchor): HTMLButtonElement {
  const button = element("button", "source-button", `回到原文 · 第 ${source.pageIndex + 1} 页`);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await payload.openSource(source); }
    catch (error) { window.alert(`无法打开原文：${String(error)}`); }
    finally { button.disabled = false; }
  });
  return button;
}

function collectVocabulary(guide: StudyGuide): VocabularyEntry[] {
  const result = new Map<string, VocabularyEntry>();
  for (const section of guide.sections) for (const unit of section.units) {
    for (const entry of unit.vocabulary) if (!result.has(entry.word.toLowerCase())) result.set(entry.word.toLowerCase(), entry);
  }
  return [...result.values()];
}

function cropVisual(canvas: HTMLCanvasElement, viewport: any, visual: PaperVisual): string {
  if (!visual.bbox) return "";
  const [x0, y0, x1, y1] = visual.bbox;
  const first = viewport.convertToViewportPoint(x0, y0);
  const second = viewport.convertToViewportPoint(x1, y1);
  let left = Math.min(first[0], second[0]) - 14;
  let right = Math.max(first[0], second[0]) + 14;
  let top = Math.min(first[1], second[1]) - 12;
  let bottom = Math.max(first[1], second[1]) + 12;
  if (visual.kind === "figure") {
    left = viewport.width * 0.04;
    right = viewport.width * 0.96;
    top = Math.max(0, top - viewport.height * 0.43);
  } else if (visual.kind === "table") {
    left = viewport.width * 0.04;
    right = viewport.width * 0.96;
    bottom = Math.min(viewport.height, bottom + viewport.height * 0.43);
  }
  left = Math.max(0, Math.floor(left));
  top = Math.max(0, Math.floor(top));
  right = Math.min(canvas.width, Math.ceil(right));
  bottom = Math.min(canvas.height, Math.ceil(bottom));
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, right - left);
  crop.height = Math.max(1, bottom - top);
  crop.getContext("2d")?.drawImage(canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop.toDataURL(visual.kind === "formula" ? "image/png" : "image/jpeg", 0.84);
}

async function hydrateVisuals(payload: ReaderPayload): Promise<void> {
  const pending = (payload.guide.visuals ?? []).filter((visual) => !visual.imageDataUrl && visual.bbox);
  if (!pending.length || !payload.getPdfBytes) return;
  GlobalWorkerOptions.workerSrc = "chrome://paper-reader/content/pdf.worker.mjs";
  const bytes = await payload.getPdfBytes();
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  let changed = false;
  try {
    const pageNumbers = [...new Set(pending.map((visual) => visual.pageIndex + 1))];
    for (const pageNumber of pageNumbers) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvas, canvasContext: context, viewport } as any).promise;
      for (const visual of pending.filter((entry) => entry.pageIndex + 1 === pageNumber)) {
        const imageDataUrl = cropVisual(canvas, viewport, visual);
        if (!imageDataUrl) continue;
        visual.imageDataUrl = imageDataUrl;
        const image = [...document.querySelectorAll<HTMLImageElement>("img[data-visual-id]")]
          .find((entry) => entry.dataset.visualId === visual.id);
        if (image) image.src = imageDataUrl;
        changed = true;
      }
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  if (changed) await payload.saveGuide?.(payload.guide);
}

function renderQuiz(quiz: QuizItem): HTMLElement {
  const card = element("section", "side-card");
  card.append(element("h3", "", "阅读小测"), element("div", "", quiz.question));
  const options = element("div", "quiz-options");
  const result = element("div", "quiz-result");
  quiz.options.forEach((option, index) => {
    const button = element("button", "", option);
    button.type = "button";
    button.addEventListener("click", () => {
      result.textContent = index === quiz.answerIndex ? `回答正确。${quiz.explanation}` : "再读一次原文后重试。";
      result.className = index === quiz.answerIndex ? "quiz-result" : "quiz-result warning";
    });
    options.append(button);
  });
  card.append(options, result);
  return card;
}

function render(payload: ReaderPayload): void {
  const { guide } = payload;
  document.title = `${guide.paper.title} · 智能通读`;
  const rail = document.querySelector<HTMLElement>("#rail")!;
  const article = document.querySelector<HTMLElement>("#article")!;
  const vocab = document.querySelector<HTMLElement>("#vocab")!;
  rail.replaceChildren();
  article.replaceChildren();
  vocab.replaceChildren();
  const visualById = new Map((guide.visuals ?? []).map((visual) => [visual.id, visual]));

  const paper = element("section", "card paper-card");
  paper.append(
    element("h1", "", guide.paper.title),
    element("div", "meta", [guide.paper.creators.join(", "), guide.paper.year, guide.paper.publication].filter(Boolean).join(" · ")),
    element("p", "overview", guide.overview),
    element("div", "subtle", `全文通读 · 阅读级别 ${guide.preset.level} · ${guide.generator.provider}/${guide.generator.model}`),
  );
  if (guide.generationStatus === "partial") {
    paper.append(element("div", "generation-notice", `生成尚未完成：已处理 ${guide.completedBlocks ?? 0}/${guide.totalBlocks ?? 0} 个文本块`));
  }
  article.append(paper);

  for (const [sectionIndex, section] of guide.sections.entries()) {
    const sectionNode = element("section", "section");
    sectionNode.id = `section-${sectionIndex}`;
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", section.title), element("div", "subtle", section.subtitle));
    sectionNode.append(heading);
    rail.append(navigationLink(section.title, sectionNode));

    for (const unit of section.units) {
      const unitNode = element("section", "unit");
      const head = element("div", "unit-head");
      const title = element("div");
      title.append(element("div", "unit-label", unit.label), element("div", "subtle", unit.purpose));
      head.append(title, sourceButton(payload, unit.source));
      const original = element("p", "original", unit.originalText);
      const translation = element("div", "translation", unit.translation);
      if (unit.validationStatus !== "valid") translation.classList.add("warning");
      unitNode.classList.add(`kind-${unit.contentKind ?? "prose"}`);
      unitNode.append(head);
      const visual = unit.visualId ? visualById.get(unit.visualId) : undefined;
      if (visual) {
        const figure = element("figure", `paper-visual visual-${visual.kind}`);
        const image = element("img");
        image.dataset.visualId = visual.id;
        if (visual.imageDataUrl) image.src = visual.imageDataUrl;
        image.alt = visual.caption;
        image.loading = "lazy";
        figure.append(image, element("figcaption", "", visual.caption));
        unitNode.append(figure);
      }
      if (unit.contentKind !== "formula") unitNode.append(original);
      if (unit.translation) unitNode.append(translation);
      if (unit.logic.length) {
        const list = element("ul", "logic-list");
        unit.logic.forEach((note) => {
          const row = element("li");
          const label = element("strong", "", `${note.label}：`);
          row.append(label, document.createTextNode(note.explanation));
          list.append(row);
        });
        unitNode.append(list);
      }
      sectionNode.append(unitNode);
    }
    article.append(sectionNode);
  }

  if (guide.metrics.length) {
    const results = element("section", "section");
    results.id = "section-key-results";
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", "关键实验结果"), element("div", "subtle", "仅显示数字可逐字回溯到原文的指标"));
    results.append(heading);
    rail.append(navigationLink("关键结果", results));
    for (const metric of guide.metrics) {
      const card = element("section", "unit metric-card");
      const head = element("div", "unit-head");
      const title = element("div");
      title.append(element("div", "unit-label", metric.label), element("div", "metric-value", metric.value));
      head.append(title, sourceButton(payload, metric.source));
      card.append(head, element("p", "metric-explanation", metric.explanation));
      results.append(card);
    }
    article.append(results);
  }

  if (guide.criticalReading.length) {
    const critical = element("section", "section");
    critical.id = "section-critical-reading";
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", "批判性阅读"), element("div", "subtle", "以下为编辑性分析，不等同于作者结论"));
    critical.append(heading);
    rail.append(navigationLink("批判性阅读", critical));
    for (const prompt of guide.criticalReading) {
      const card = element("section", "unit");
      card.append(element("h3", "", prompt.title), element("p", "metric-explanation", prompt.commentary));
      const sourceRow = element("div", "source-row");
      prompt.sources.forEach((source) => sourceRow.append(sourceButton(payload, source)));
      card.append(sourceRow);
      critical.append(card);
    }
    article.append(critical);
  }

  if (guide.logicGraph?.nodes.length) {
    const logic = element("section", "section logic-section");
    logic.id = "section-logic-graph";
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", guide.logicGraph.title || "论文逻辑线路"), element("div", "subtle", "点击节点来源可返回论文原文"));
    logic.append(heading);
    rail.append(navigationLink("逻辑线路", logic));
    const graph = element("div", "logic-graph");
    guide.logicGraph.nodes.forEach((node, index) => {
      const card = element("article", `logic-node logic-${node.kind}`);
      card.append(element("div", "logic-index", String(index + 1)), element("h3", "", node.label), element("p", "", node.explanation));
      const sources = element("div", "source-row");
      node.sources.slice(0, 2).forEach((source) => sources.append(sourceButton(payload, source)));
      card.append(sources);
      graph.append(card);
      if (index < guide.logicGraph!.nodes.length - 1) {
        const outgoing = guide.logicGraph!.edges.find((edge) => edge.from === node.id);
        graph.append(element("div", "logic-arrow", outgoing?.label ? `↓ ${outgoing.label}` : "↓"));
      }
    });
    logic.append(graph);
    article.append(logic);
  }

  const terms = collectVocabulary(guide);
  const termCard = element("section", "side-card");
  termCard.append(element("h3", "", "核心术语"));
  if (!terms.length) termCard.append(element("div", "subtle", "API 联调后显示术语解释"));
  terms.slice(0, 18).forEach((term) => {
    const row = element("div", "term");
    row.append(element("b", "", term.word), element("span", "", `${term.partOfSpeech} ${term.meaning}`.trim()));
    termCard.append(row);
  });
  vocab.append(termCard);

  if (guide.methodFlow.length) {
    const methodCard = element("section", "side-card");
    methodCard.append(element("h3", "", "方法流程"));
    const flow = element("div", "method-flow");
    guide.methodFlow.forEach((node, index) => flow.append(element("div", "method-node", `${index + 1}. ${node.label} — ${node.explanation}`)));
    methodCard.append(flow);
    vocab.append(methodCard);
  }
  guide.quiz.slice(0, 3).forEach((quiz) => vocab.append(renderQuiz(quiz)));
}

function setupControls(): void {
  document.querySelector("#toggle-translation")?.addEventListener("click", (event) => {
    const hidden = document.querySelector(".translation")?.classList.contains("hidden") ?? false;
    document.querySelectorAll(".translation").forEach((node) => node.classList.toggle("hidden", !hidden));
    (event.currentTarget as HTMLButtonElement).textContent = hidden ? "隐藏译文" : "显示译文";
  });
  let size = 17;
  const updateSize = (delta: number) => {
    size = Math.max(14, Math.min(23, size + delta));
    document.documentElement.style.setProperty("--reading-size", `${size}px`);
  };
  document.querySelector("#font-down")?.addEventListener("click", () => updateSize(-1));
  document.querySelector("#font-up")?.addEventListener("click", () => updateSize(1));
  window.addEventListener("scroll", () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const progress = total <= 0 ? 100 : Math.min(100, window.scrollY / total * 100);
    const bar = document.querySelector<HTMLElement>("#progress-bar");
    if (bar) bar.style.width = `${progress}%`;
  }, { passive: true });
}

window.addEventListener("DOMContentLoaded", () => {
  setupControls();
  const payload = window.arguments?.[0]?.wrappedJSObject as ReaderPayload | undefined;
  if (!payload?.guide) {
    document.querySelector("#article")!.textContent = "没有可显示的通读内容。";
    return;
  }
  render(payload);
  void hydrateVisuals(payload).catch((error) => {
    console.error("[Paper Reading Assistant] failed to render paper visuals", error);
  });
});
