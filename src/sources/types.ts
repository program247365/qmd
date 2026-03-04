export interface SourceDocument {
  path: string;
  content: string;
  title?: string;
  created?: string;
  modified?: string;
}

export interface CollectionSource {
  readDocuments(): Promise<SourceDocument[]>;
}
