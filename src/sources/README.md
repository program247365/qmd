# Source Plugins

Source plugins let QMD index non-filesystem content — apps with their own databases, APIs, or any structured data that doesn't live as files on disk.

Filesystem collections (`qmd collection add ~/notes`) are handled separately by `indexFiles()` and are **not** part of this system.

## How it works

Each source plugin implements `CollectionSource` from `types.ts`:

```typescript
interface SourceDocument {
  path: string;      // Unique identifier for the document (e.g., "{uuid}.md")
  content: string;   // Full text content
  title?: string;    // Optional — extracted from content if not provided
  created?: string;  // ISO8601
  modified?: string; // ISO8601
}

interface CollectionSource {
  readDocuments(): Promise<SourceDocument[]>;
}
```

The core calls `readDocuments()`, then handles hashing, deduplication, insert/update, deactivation of removed documents, and orphan cleanup — the same lifecycle as filesystem collections.

## Adding a new source

1. Create `src/sources/your-source.ts`:

```typescript
import type { CollectionSource, SourceDocument } from "./types.js";

export default {
  async readDocuments(): Promise<SourceDocument[]> {
    // Fetch documents from your data source
    const items = await fetchFromSomewhere();
    return items.map(item => ({
      path: item.id,           // Must be unique and stable across re-indexes
      content: item.body,
      title: item.name,
      created: item.createdAt,
      modified: item.updatedAt,
    }));
  },
} satisfies CollectionSource;
```

2. Register it in `src/sources/index.ts`:

```typescript
registry.set("your-source", () => import("./your-source.js").then(m => m.default));
```

That's it. No changes to `qmd.ts`, `store.ts`, or `collections.ts`.

Users add it with:

```sh
qmd collection add --type your-source --name my-collection
```

## Key constraints

- **`path` must be stable.** QMD uses `path` to detect new, changed, and removed documents across re-indexes. If paths change between runs, every document gets re-indexed from scratch. UUIDs or content-addressable IDs work well. Slugified titles do not.

- **`readDocuments()` returns all active documents.** QMD diffs the returned set against what's in the index. Documents missing from the return value get deactivated (soft-deleted). Don't filter incrementally — return the full set every time.

- **Content should be plain text or markdown.** QMD's FTS5 index, chunker, and embedding formatter all assume markdown-ish content. HTML or rich formats should be converted before returning.

## Example: Apple Notes

Apple Notes stores data in a Core Data SQLite database at `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`. A source plugin would read it the same way Bear does — open read-only, query for non-trashed notes, convert Core Data timestamps.

```typescript
// src/sources/apple-notes.ts
import type { CollectionSource, SourceDocument } from "./types.js";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DB_PATH = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
);

// Core Data epoch: seconds between 1970-01-01 and 2001-01-01
const CD_EPOCH = 978307200;

export default {
  async readDocuments(): Promise<SourceDocument[]> {
    if (process.platform !== "darwin") return [];
    if (!existsSync(DB_PATH)) {
      console.error(`Apple Notes database not found: ${DB_PATH}`);
      return [];
    }

    const BetterSqlite3 = await import("better-sqlite3");
    const db = new BetterSqlite3.default(DB_PATH, { readonly: true });

    try {
      // ZICCLOUDSYNCINGOBJECT holds note metadata; ZICNOTEDATA holds the body.
      // The body is gzipped protobuf — you'd need to decompress and decode it.
      // Alternatively, use the `osascript` JXA bridge to get plaintext via
      // Apple's scripting interface (slower but avoids protobuf parsing).
      const rows = db.prepare(`
        SELECT
          n.ZIDENTIFIER as id,
          n.ZTITLE1 as title,
          n.ZCREATIONDATE3 as created,
          n.ZMODIFICATIONDATE1 as modified
        FROM ZICCLOUDSYNCINGOBJECT n
        WHERE n.ZTITLE1 IS NOT NULL
          AND n.ZMARKEDFORDELETION = 0
      `).all() as Array<{
        id: string;
        title: string;
        created: number;
        modified: number;
      }>;

      // TODO: Extract note body. Two approaches:
      //
      // 1. Protobuf: Read ZICNOTEDATA.ZDATA, gunzip, decode the proto.
      //    Fast but requires understanding Apple's internal proto schema
      //    which is undocumented and may change between macOS versions.
      //
      // 2. JXA/osascript: Shell out to `osascript -l JavaScript` and use
      //    Application("Notes").notes().plaintext(). Slow (~1 note/sec)
      //    but stable across OS versions.
      //
      // The Bear plugin avoids this problem because Bear stores markdown
      // as plain text in its SQLite DB.

      return rows.map(r => ({
        path: `${r.id}.md`,
        content: "",  // ← replace with actual body extraction
        title: r.title,
        created: new Date((r.created + CD_EPOCH) * 1000).toISOString(),
        modified: new Date((r.modified + CD_EPOCH) * 1000).toISOString(),
      }));
    } finally {
      db.close();
    }
  },
} satisfies CollectionSource;
```

Then register in `src/sources/index.ts`:

```typescript
registry.set("apple-notes", () => import("./apple-notes.js").then(m => m.default));
```

The hard part is extracting the note body — Apple stores it as gzipped protobuf, not plain text. The `TODO` comment above outlines the two viable approaches.

## Existing plugins

| Source | Type flag | Description |
|--------|-----------|-------------|
| [bear.ts](bear.ts) | `bear` | Bear Notes (macOS). Reads from Bear's Core Data SQLite database. |
