import type { StudyGuide } from "../domain/types";
import { parseStudyGuide } from "../domain/schema";

export class GuideRepository {
  private db: any;

  async init(): Promise<void> {
    const path = PathUtils.join(Zotero.Profile.dir, "paper-reading-assistant.sqlite");
    this.db = new Zotero.DBConnection(path);
    await this.db.queryAsync(`
      CREATE TABLE IF NOT EXISTS guides (
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        attachment_key TEXT NOT NULL,
        attachment_version INTEGER NOT NULL,
        pdf_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (library_id, item_key, attachment_key)
      )
    `);
  }

  async save(guide: StudyGuide): Promise<void> {
    this.assertReady();
    await this.db.queryAsync(
      `INSERT INTO guides (
        library_id, item_key, attachment_key, attachment_version,
        pdf_hash, payload_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(library_id, item_key, attachment_key) DO UPDATE SET
        attachment_version = excluded.attachment_version,
        pdf_hash = excluded.pdf_hash,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at`,
      [
        guide.paper.libraryId,
        guide.paper.itemKey,
        guide.paper.attachmentKey,
        guide.paper.attachmentVersion,
        guide.paper.pdfHash,
        JSON.stringify(guide),
        new Date().toISOString(),
      ],
    );
  }

  async get(libraryId: number, itemKey: string, attachmentKey?: string): Promise<StudyGuide | null> {
    this.assertReady();
    const rows = attachmentKey
      ? await this.db.queryAsync(
        `SELECT payload_json FROM guides
         WHERE library_id = ? AND item_key = ? AND attachment_key = ?
         ORDER BY updated_at DESC LIMIT 1`,
        [libraryId, itemKey, attachmentKey],
      )
      : await this.db.queryAsync(
        `SELECT payload_json FROM guides
         WHERE library_id = ? AND item_key = ?
         ORDER BY updated_at DESC LIMIT 1`,
        [libraryId, itemKey],
      );
    if (!rows.length) return null;
    try {
      return parseStudyGuide(JSON.parse(rows[0].payload_json));
    } catch (error) {
      Zotero.logError(error);
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.db) await this.db.closeDatabase();
    this.db = null;
  }

  private assertReady(): void {
    if (!this.db) throw new Error("Guide repository is not initialized");
  }
}
