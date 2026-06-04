export interface RetrievalHit {
  chunkId: string;
  documentId: string;
  documentName: string;
  score: number;
  content: string;
  sectionTitle?: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface RetrievalDiagnostics {
  query: string;
  normalizedQuery: string;
  topKRequested: number;
  topKReturned: number;
  indexesQueried: Array<"sqlite-keyword" | "chroma" | "faiss">;
}

export interface ResearchQuestionRequest {
  projectId: string;
  conversationId?: string;
  query: string;
  model: string;
  stream?: boolean;
  topK?: number;
}

export interface ResearchAnswerCitation {
  citationId: string;
  documentId: string;
  chunkId: string;
  documentName: string;
  snippet: string;
  score: number;
}

export interface ResearchAnswerResponse {
  answer: string;
  citations: ResearchAnswerCitation[];
  diagnostics?: RetrievalDiagnostics;
}
