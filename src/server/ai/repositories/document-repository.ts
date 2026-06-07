import type {
  DocumentChunk,
  UploadedDocument,
} from "@/features/ai/contracts/documents";

export interface CreateDocumentRecordInput {
  id: string;
  projectId: string;
  name: string;
  kind: UploadedDocument["kind"];
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  status: UploadedDocument["status"];
  parserVersion?: string;
  chunkerVersion?: string;
  embeddingModel?: string;
  parseError?: string;
}

export interface InsertDocumentChunkInput {
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

export interface DocumentRepository {
  createDocument(input: CreateDocumentRecordInput): Promise<UploadedDocument>;
  deleteDocument(documentId: string): Promise<UploadedDocument | null>;
  updateDocumentStatus(
    documentId: string,
    status: UploadedDocument["status"],
    parseError?: string,
  ): Promise<void>;
  listDocumentsByProject(projectId: string): Promise<UploadedDocument[]>;
  getDocument(documentId: string): Promise<UploadedDocument | null>;
  getDocumentByProjectHash(
    projectId: string,
    sha256: string,
  ): Promise<UploadedDocument | null>;
  insertChunks(chunks: InsertDocumentChunkInput[]): Promise<DocumentChunk[]>;
  listChunksByDocument(documentId: string): Promise<DocumentChunk[]>;
  searchChunks(input: {
    projectId: string;
    documentId?: string;
    query: string;
    topK: number;
  }): Promise<Array<DocumentChunk & { documentName: string; score: number }>>;
}
