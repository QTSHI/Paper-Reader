import type { PaperRef, ReaderPreset } from "../domain/types";
import type { ExtractedDocument } from "../source/pdf";
import { extractPdf } from "../source/pdf";

export interface ZoteroSelection {
  item: any;
  attachment: any;
  filePath: string;
}

function isPdfAttachment(item: any): boolean {
  return Boolean(item?.isAttachment?.() && item.attachmentContentType === "application/pdf");
}

async function pdfAttachments(item: any): Promise<any[]> {
  if (isPdfAttachment(item)) return [item];
  if (!item?.isRegularItem?.()) return [];
  const ids: number[] = item.getAttachments(false);
  const attachments = await Zotero.Items.getAsync(ids);
  return attachments.filter(isPdfAttachment);
}

function chooseAttachment(win: Window, attachments: any[]): any | null {
  if (attachments.length === 1) return attachments[0];
  const labels = attachments.map((attachment) => {
    const title = attachment.getField("title") || "PDF";
    const filename = attachment.attachmentFilename || "";
    return filename && filename !== title ? `${title} — ${filename}` : title;
  });
  const selected = { value: 0 };
  const ok = Services.prompt.select(
    win,
    "选择论文 PDF",
    "该条目包含多个 PDF，请选择用于生成全文通读的附件：",
    labels,
    selected,
  );
  return ok ? attachments[selected.value] : null;
}

export async function resolveSelection(win: Window, preferredItem?: any): Promise<ZoteroSelection | null> {
  const selected = preferredItem ? [preferredItem] : Zotero.getActiveZoteroPane().getSelectedItems();
  if (selected.length !== 1) {
    Services.prompt.alert(win, "无法生成通读", "请只选择一个论文条目或 PDF 附件。");
    return null;
  }

  const selectedItem = selected[0];
  const parent = isPdfAttachment(selectedItem) && selectedItem.parentID
    ? await Zotero.Items.getAsync(selectedItem.parentID)
    : selectedItem;
  const attachments = await pdfAttachments(selectedItem);
  if (attachments.length === 0) {
    const parentAttachments = selectedItem === parent ? [] : await pdfAttachments(parent);
    attachments.push(...parentAttachments);
  }
  if (attachments.length === 0) {
    Services.prompt.alert(win, "无法生成通读", "所选条目没有可用的 PDF 附件。");
    return null;
  }

  const attachment = chooseAttachment(win, attachments);
  if (!attachment) return null;
  const filePath = await attachment.getFilePathAsync();
  if (!filePath || !(await IOUtils.exists(filePath))) {
    Services.prompt.alert(win, "无法生成通读", "PDF 文件在本机不存在或尚未同步完成。");
    return null;
  }
  return { item: parent, attachment, filePath };
}

export async function extractSelection(selection: ZoteroSelection): Promise<ExtractedDocument> {
  const bytes = await IOUtils.read(selection.filePath);
  return extractPdf(new Uint8Array(bytes));
}

export function paperRefFromSelection(selection: ZoteroSelection, document: ExtractedDocument): PaperRef {
  const item = selection.item;
  const attachment = selection.attachment;
  const date = String(item.getField("date") || "");
  return {
    libraryId: item.libraryID,
    itemKey: item.key,
    attachmentKey: attachment.key,
    attachmentId: attachment.id,
    attachmentVersion: attachment.version ?? 0,
    title: item.getField("title") || attachment.getField("title") || "Untitled paper",
    creators: item.getCreators().map((creator: any) => [creator.firstName, creator.lastName].filter(Boolean).join(" ")),
    year: date.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? "",
    publication: item.getField("publicationTitle") || item.getField("proceedingsTitle") || "",
    doi: item.getField("DOI") || "",
    pageCount: document.pageCount,
    pdfHash: document.pdfHash,
  };
}

export function readPreset(): ReaderPreset {
  return {
    level: (Zotero.Prefs.get("extensions.paperReadingAssistant.readerLevel") || "B1") as ReaderPreset["level"],
    background: (Zotero.Prefs.get("extensions.paperReadingAssistant.background") || "foundation") as ReaderPreset["background"],
    assistance: (Zotero.Prefs.get("extensions.paperReadingAssistant.assistance") || "standard") as ReaderPreset["assistance"],
  };
}

export async function openSource(paper: PaperRef, pageIndex: number, quote: string): Promise<void> {
  if (!paper.attachmentId) throw new Error("The Zotero attachment ID is missing");
  if (typeof Zotero.Reader.open === "function") {
    await Zotero.Reader.open(paper.attachmentId, { pageIndex });
    return;
  }
  const pane = Zotero.getActiveZoteroPane();
  if (typeof pane.viewPDF === "function") {
    await pane.viewPDF(paper.attachmentId, pageIndex + 1, quote);
    return;
  }
  throw new Error("This Zotero version cannot open a PDF source location");
}
