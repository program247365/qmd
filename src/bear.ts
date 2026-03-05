/**
 * Bear Notes SQLite reader
 *
 * Reads notes from Bear's local Core Data SQLite database (macOS only).
 * Produces BearNote[] that the qmd indexer can consume like any other document source.
 */

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Bear's well-known database path on macOS
const BEAR_DB_PATH = join(
  homedir(),
  "Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite"
);

// Core Data epoch offset: seconds between Unix epoch (1970) and Core Data epoch (2001-01-01)
const CORE_DATA_EPOCH_OFFSET = 978307200;

export interface BearNote {
  uuid: string;
  title: string;
  text: string;
  created: string;   // ISO8601
  modified: string;  // ISO8601
  tags: string[];
  path: string;      // Virtual path for qmd (tag-based directory + slugified title)
}

/**
 * Convert a Core Data timestamp (seconds since 2001-01-01) to ISO8601 string.
 */
export function coreDataTimestampToISO(timestamp: number): string {
  return new Date((timestamp + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString();
}

/**
 * Pick the most specific (deepest) tag to use as directory prefix.
 * Bear tags use `/` for nesting: "projects/slack-emojis" has depth 2.
 * Returns "_untagged" if no tags.
 */
/**
 * Build a virtual path for a Bear note from its UUID.
 * UUIDs are stable across renames and retags — no edge cases with titles.
 */
export function buildBearPath(uuid: string): string {
  return `${uuid}.md`;
}

/**
 * Read all indexable notes from Bear's SQLite database.
 *
 * Skips trashed, encrypted, and permanently deleted notes.
 * Requires macOS — returns empty array with a warning on other platforms.
 */
export async function readBearNotes(): Promise<BearNote[]> {
  if (process.platform !== "darwin") {
    console.error("Bear notes are only available on macOS.");
    return [];
  }

  if (!existsSync(BEAR_DB_PATH)) {
    console.error(`Bear database not found: ${BEAR_DB_PATH}`);
    console.error("Is Bear installed?");
    return [];
  }

  const BetterSqlite3 = await import("better-sqlite3");
  const Database = BetterSqlite3.default;
  const db = new Database(BEAR_DB_PATH, { readonly: true });

  try {
    // Fetch all non-trashed, non-encrypted, non-deleted notes
    const notes = db.prepare(`
      SELECT
        Z_PK as pk,
        ZUNIQUEIDENTIFIER as uuid,
        ZTITLE as title,
        ZTEXT as text,
        ZCREATIONDATE as created,
        ZMODIFICATIONDATE as modified
      FROM ZSFNOTE
      WHERE ZTRASHED = 0
        AND ZENCRYPTED = 0
        AND ZPERMANENTLYDELETED = 0
    `).all() as Array<{
      pk: number;
      uuid: string;
      title: string | null;
      text: string | null;
      created: number;
      modified: number;
    }>;

    // Fetch all tag associations in one query (avoids N+1)
    const tagRows = db.prepare(`
      SELECT
        jt.Z_5NOTES as note_pk,
        t.ZTITLE as tag
      FROM Z_5TAGS jt
      JOIN ZSFNOTETAG t ON t.Z_PK = jt.Z_13TAGS
    `).all() as Array<{ note_pk: number; tag: string }>;

    // Build a map of note PK -> tag names
    const tagsByNote = new Map<number, string[]>();
    for (const row of tagRows) {
      const existing = tagsByNote.get(row.note_pk);
      if (existing) {
        existing.push(row.tag);
      } else {
        tagsByNote.set(row.note_pk, [row.tag]);
      }
    }

    // Assemble BearNote objects
    const result: BearNote[] = [];
    for (const note of notes) {
      // Skip notes with no text content
      if (!note.text?.trim()) continue;

      const title = note.title || "Untitled";
      const tags = tagsByNote.get(note.pk) || [];
      const path = buildBearPath(note.uuid);

      result.push({
        uuid: note.uuid,
        title,
        text: note.text,
        created: coreDataTimestampToISO(note.created),
        modified: coreDataTimestampToISO(note.modified),
        tags,
        path,
      });
    }

    return result;
  } finally {
    db.close();
  }
}
