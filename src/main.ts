import type { SourceAnchor, StudyGuide } from "./domain/types";
import { parseStudyGuide } from "./domain/schema";
import { createMockGuide } from "./generation/mock";
import { createDeepSeekGuide } from "./generation/deepseek";
import { extractSelection, openSource, paperRefFromSelection, readPreset, resolveSelection } from "./integration/zotero";
import { GuideRepository } from "./storage/repository";
import { classifyVisualKind } from "./source/pdf";
import { discardUntraceableMetrics, validateFullReadingCoverage, validateGuideSources } from "./validation/guide";

const PLUGIN_ID = "paper-reading-assistant@local";
const PANE_ID = "paper-reading-assistant-pane";
const MENU_ID = "paper-reading-assistant-menuitem";
const REGENERATE_MENU_ID = "paper-reading-assistant-regenerate-menuitem";
const repository = new GuideRepository();

function mark(stage: string): void {
  Services.console.logStringMessage(`[Paper Reading Assistant] ${stage}`);
}

function progress(title: string): any {
  const window = new Zotero.ProgressWindow({ closeOnClick: false });
  window.changeHeadline(title);
  window.show();
  return window;
}

function openGuideWindow(guide: StudyGuide): void {
  if (!(guide.visuals?.length)) {
    const visuals = [] as NonNullable<StudyGuide["visuals"]>;
    const counts = { figure: 0, table: 0, formula: 0 };
    for (const section of guide.sections) for (const unit of section.units) {
      const kind = classifyVisualKind(unit.originalText);
      const limit = kind === "formula" ? 24 : 14;
      if (!kind || !unit.source.bbox || counts[kind] >= limit) continue;
      counts[kind] += 1;
      const id = `visual-${unit.source.blockId}`;
      visuals.push({
        id, kind, pageIndex: unit.source.pageIndex,
        caption: kind === "formula" ? `公式区域 · 第 ${unit.source.pageIndex + 1} 页` : unit.originalText,
        imageDataUrl: "", sourceBlockId: unit.source.blockId, bbox: unit.source.bbox,
      });
      unit.visualId = id;
      unit.contentKind = kind === "formula" ? "formula" : "caption";
      if (kind === "formula") unit.translation = "";
    }
    guide.visuals = visuals;
    if (visuals.length) void repository.save(guide);
  }
  const args = {
    wrappedJSObject: {
      guide,
      openSource: (anchor: SourceAnchor) => openSource(guide.paper, anchor.pageIndex, anchor.quote),
      getPdfBytes: async () => {
        if (!guide.paper.attachmentId) throw new Error("缺少 Zotero PDF 附件 ID");
        const attachment = await Zotero.Items.getAsync(guide.paper.attachmentId);
        const filePath = await attachment?.getFilePathAsync?.();
        if (!filePath || !(await IOUtils.exists(filePath))) throw new Error("PDF 文件在本机不可用");
        return new Uint8Array(await IOUtils.read(filePath));
      },
      saveGuide: (updated: StudyGuide) => repository.save(updated),
    },
  };
  Services.ww.openWindow(
    null,
    "chrome://paper-reader/content/reader.xhtml",
    `paper-reading-${guide.paper.itemKey}`,
    "chrome,dialog=no,resizable,centerscreen,width=1280,height=900",
    args,
  );
}

async function generate(win: Window, item?: any): Promise<void> {
  mark("generation requested");
  const selection = await resolveSelection(win, item);
  if (!selection) return;
  mark(`attachment selected: ${selection.attachment.key}`);
  const report = progress("正在生成全文智能通读");
  const line = new report.ItemProgress("chrome://zotero/skin/treeitem-journalArticle.svg", "读取 PDF 并建立原文定位…");
  try {
    line.setProgress(12);
    const document = await extractSelection(selection);
    mark(`PDF parsed: ${document.pageCount} pages, ${document.blocks.length} blocks`);
    line.setText(`已解析 ${document.pageCount} 页、${document.blocks.length} 个文本块和 ${document.visuals.length} 个图像区域，正在分章处理全文…`);
    line.setProgress(18);

    const paper = paperRefFromSelection(selection, document);
    const preset = readPreset();
    const provider = String(Zotero.Prefs.get("extensions.paperReadingAssistant.provider") || "deepseek");
    line.setText(provider === "mock" ? "正在生成本地预览…" : "正在调用 DeepSeek V4 Flash 分章处理全文…");
    const generated = provider === "mock"
      ? createMockGuide(paper, document, preset)
      : await createDeepSeekGuide(paper, document, preset, {
        onProgress: (completed, total, label) => {
          line.setText(label);
          line.setProgress(20 + Math.round((completed / Math.max(total, 1)) * 65));
        },
        onCheckpoint: async (checkpoint) => repository.save(checkpoint),
      });
    mark("model response received");
    const guide = parseStudyGuide(generated);
    const removedMetrics = discardUntraceableMetrics(guide, document.blocks);
    const validation = validateGuideSources(guide, document.blocks);
    if (!validation.valid) throw new Error(`原文校验失败：${validation.errors.slice(0, 3).join("；")}`);
    const coverage = validateFullReadingCoverage(guide, document.blocks);
    if (!coverage.valid) throw new Error(`全文覆盖校验失败：${coverage.errors.slice(0, 3).join("；")}`);
    line.setText(`已校验 ${validation.checkedUnits} 个原文片段${removedMetrics.length ? `，剔除 ${removedMetrics.length} 个可疑指标` : ""}，正在保存…`);
    line.setProgress(88);
    await repository.save(guide);
    mark("guide validated and saved");
    line.setText("全文通读页面已生成并覆盖旧结果");
    line.setProgress(100);
    report.startCloseTimer(1800);
    openGuideWindow(guide);
  } catch (error) {
    mark(`generation failed: ${error instanceof Error ? error.message : String(error)}`);
    Zotero.logError(error);
    line.setError();
    line.setText(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    report.startCloseTimer(8000);
  }
}

async function openSaved(win: Window, item: any): Promise<void> {
  if (!item) {
    await generate(win);
    return;
  }
  const parent = item?.isAttachment?.() && item.parentID ? await Zotero.Items.getAsync(item.parentID) : item;
  const guide = await repository.get(parent.libraryID, parent.key, item?.isAttachment?.() ? item.key : undefined);
  if (guide) openGuideWindow(guide);
  else await generate(win, item);
}

function registerItemPane(rootURI: string): void {
  if (!Zotero.ItemPaneManager?.registerSection) return;
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: PLUGIN_ID,
    header: { l10nID: "paper-reading-assistant-pane-header", icon: `${rootURI}icons/book.svg` },
    sidenav: { l10nID: "paper-reading-assistant-pane-header", icon: `${rootURI}icons/book.svg` },
    onRender: async ({ body, item }: any) => {
      body.replaceChildren();
      if (!item?.isRegularItem?.() && !item?.isAttachment?.()) {
        body.textContent = "请选择一个论文条目或 PDF 附件。";
        return;
      }
      const parent = item.isAttachment?.() && item.parentID ? await Zotero.Items.getAsync(item.parentID) : item;
      const guide = await repository.get(parent.libraryID, parent.key, item.isAttachment?.() ? item.key : undefined);
      const status = body.ownerDocument.createElement("div");
      status.textContent = guide
        ? (guide.generationStatus === "partial" ? "通读生成未完成，可查看已完成内容" : "全文通读已生成")
        : "尚未生成全文通读";
      status.style.marginBottom = "8px";
      const button = body.ownerDocument.createElement("button");
      button.textContent = guide ? "打开通读" : "生成全文通读";
      button.addEventListener("click", () => guide ? openGuideWindow(guide) : void generate(body.ownerGlobal, item));
      body.append(status, button);
      if (guide) {
        const regenerate = body.ownerDocument.createElement("button");
        regenerate.textContent = "重新生成全文通读";
        regenerate.style.marginLeft = "8px";
        regenerate.addEventListener("click", () => void generate(body.ownerGlobal, item));
        body.append(regenerate);
      }
    },
  });
}

function addItemMenu(win: Window): void {
  const doc = win.document;
  if (doc.getElementById(MENU_ID)) return;
  const menu = doc.getElementById("zotero-itemmenu");
  if (!menu) return;
  const xulDocument = doc as Document & { createXULElement?: (name: string) => Element };
  const item = xulDocument.createXULElement?.("menuitem") ?? doc.createElement("menuitem");
  item.id = MENU_ID;
  item.setAttribute("label", "生成 / 打开全文通读");
  item.addEventListener("command", () => void openSaved(win, Zotero.getActiveZoteroPane().getSelectedItems()[0]));
  menu.append(item);
  const regenerate = xulDocument.createXULElement?.("menuitem") ?? doc.createElement("menuitem");
  regenerate.id = REGENERATE_MENU_ID;
  regenerate.setAttribute("label", "重新生成全文通读（覆盖旧结果）");
  regenerate.addEventListener("command", () => void generate(win, Zotero.getActiveZoteroPane().getSelectedItems()[0]));
  menu.append(regenerate);
}

export async function startup({ rootURI }: { rootURI: string }): Promise<void> {
  await Zotero.initializationPromise;
  await repository.init();
  registerItemPane(rootURI);
  for (const win of Zotero.getMainWindows()) addItemMenu(win);
}

export async function shutdown(): Promise<void> {
  try { Zotero.ItemPaneManager?.unregisterSection?.(PANE_ID); } catch (error) { Zotero.logError(error); }
  for (const win of Zotero.getMainWindows()) {
    win.document.getElementById(MENU_ID)?.remove();
    win.document.getElementById(REGENERATE_MENU_ID)?.remove();
  }
  await repository.close();
}

export async function onMainWindowLoad(win: Window): Promise<void> { addItemMenu(win); }
export async function onMainWindowUnload(win: Window): Promise<void> {
  win.document.getElementById(MENU_ID)?.remove();
  win.document.getElementById(REGENERATE_MENU_ID)?.remove();
}
