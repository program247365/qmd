import type { CollectionSource, SourceDocument } from "./types.js";

export default {
  async readDocuments(): Promise<SourceDocument[]> {
    const { readBearNotes } = await import("../bear.js");
    const notes = await readBearNotes();
    return notes.map(n => ({
      path: n.path,
      content: n.text,
      title: n.title,
      created: n.created,
      modified: n.modified,
    }));
  },
} satisfies CollectionSource;
