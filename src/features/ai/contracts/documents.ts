export type DocumentStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "chunking"
  | "embedding"
  | "indexed"
  | "failed";

export type DocumentKind =
  | "pdf"
  | "png"
  | "jpeg"
  | "docx"
  | "txt"
  | "md"
  | "html"
  | "url";

export interface UploadedDocument {
  id: string;
  projectId: string;
  name: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  status: DocumentStatus;
  parserVersion?: string;
  chunkerVersion?: string;
  embeddingModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedDocumentContent {
  documentId: string;
  plainText: string;
  pageCount?: number;
  imageCount?: number;
  altText?: string[];
  headings?: string[];
  language?: string;
  extractedAt: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
  contentHash: string;
}

export interface EmbeddingVectorRecord {
  id: string;
  documentId: string;
  chunkId: string;
  embeddingModel: string;
  dimensions: number;
  vectorStore: "chroma" | "faiss";
  createdAt: string;
}

export interface UploadDocumentResponse {
  document: UploadedDocument;
  chunksCreated: number;
  extractedText?: string;
  warning?: string;
}

export interface RetrieveDocumentRequest {
  projectId: string;
  documentId?: string;
  query: string;
  topK?: number;
}

export interface UploadDocumentRequest {
  projectId: string;
  workspaceId?: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface ListDocumentsResponse {
  documents: UploadedDocument[];
}
