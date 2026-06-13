import type { DocumentChunk } from "@/features/ai/contracts/documents";

export type VectorStoreKind = "faiss" | "sqlite-faiss" | "chroma";

export interface InsertVectorRecordInput {
  id: string;
  projectId: string;
  documentId: string;
  chunkId: string;
  vectorStore: VectorStoreKind;
  embeddingModel: string;
  dimensions: number;
  vector: number[];
}

export interface VectorSearchInput {
  projectId: string;
  documentId?: string;
  embeddingModel: string;
  queryVector: number[];
  topK: number;
  vectorStore?: VectorStoreKind;
}

export interface VectorSearchHit extends DocumentChunk {
  documentName: string;
  score: number;
  vectorStore: VectorStoreKind;
}

export interface VectorRepository {
  insertVectors(vectors: InsertVectorRecordInput[]): Promise<void>;
  searchSimilar(input: VectorSearchInput): Promise<VectorSearchHit[]>;
  rebuildProjectIndex(projectId: string, embeddingModel: string): Promise<void>;
}
