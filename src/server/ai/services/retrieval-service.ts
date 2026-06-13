import type {
  ChatAttachmentRef,
  ChatContextSelection,
} from "@/features/ai/contracts/chat";
import type {
  ResearchAnswerCitation,
  RetrievalHit,
} from "@/features/ai/contracts/rag";
import type { DocumentRepository } from "@/server/ai/repositories/document-repository";
import type { VectorRepository } from "@/server/ai/repositories/vector-repository";
import type { EmbeddingService } from "@/server/ai/services/embedding-service";

export interface RetrievalServiceDependencies {
  documentRepository: DocumentRepository;
  vectorRepository?: VectorRepository;
  embeddingService?: EmbeddingService;
}

export class RetrievalService {
  private readonly documentRepository: DocumentRepository;
  private readonly vectorRepository?: VectorRepository;
  private readonly embeddingService?: EmbeddingService;

  constructor(dependencies: RetrievalServiceDependencies) {
    this.documentRepository = dependencies.documentRepository;
    this.vectorRepository = dependencies.vectorRepository;
    this.embeddingService = dependencies.embeddingService;
  }

  async retrieve(input: {
    projectId: string;
    documentId?: string;
    query: string;
    topK?: number;
  }): Promise<RetrievalHit[]> {
    if (this.vectorRepository && this.embeddingService) {
      try {
        const queryVector = await this.embeddingService.embedText(input.query);
        const vectorHits = await this.vectorRepository.searchSimilar({
          projectId: input.projectId,
          documentId: input.documentId,
          embeddingModel: this.embeddingService.model,
          queryVector,
          topK: input.topK ?? 6,
          vectorStore: "sqlite-faiss",
        });

        if (vectorHits.length > 0) {
          return vectorHits.map((hit) => ({
            chunkId: hit.id,
            documentId: hit.documentId,
            documentName: hit.documentName,
            score: hit.score,
            content: hit.content,
            sectionTitle: hit.sectionTitle,
            pageStart: hit.pageStart,
            pageEnd: hit.pageEnd,
          }));
        }
      } catch {
        // Fall back to keyword retrieval when local embedding infrastructure is unavailable.
      }
    }

    const chunks = await this.documentRepository.searchChunks({
      projectId: input.projectId,
      documentId: input.documentId,
      query: input.query,
      topK: input.topK ?? 6,
    });

    return chunks.map((chunk) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      score: chunk.score,
      content: chunk.content,
      sectionTitle: chunk.sectionTitle,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    }));
  }

  async buildChatContext(input: {
    projectId: string;
    query: string;
    topK?: number;
    existingContext?: ChatContextSelection;
  }): Promise<ChatContextSelection> {
    const hits = await this.retrieve({
      projectId: input.projectId,
      query: input.query,
      topK: input.topK ?? input.existingContext?.topK,
    });

    const retrievedRefs: ChatAttachmentRef[] = hits.map((hit) => ({
      documentId: hit.documentId,
      chunkIds: [hit.chunkId],
      label: hit.documentName,
      kind: "text",
      summary: [
        hit.pageStart ? `Page ${hit.pageStart}` : undefined,
        `Score ${hit.score}`,
        hit.content.slice(0, 900),
      ]
        .filter(Boolean)
        .join("\n"),
    }));

    return {
      ...input.existingContext,
      retrievalQuery: input.existingContext?.retrievalQuery ?? input.query,
      topK: input.existingContext?.topK ?? input.topK,
      attachmentRefs: [
        ...(input.existingContext?.attachmentRefs ?? []),
        ...retrievedRefs,
      ],
    };
  }

  toCitations(hits: RetrievalHit[]): ResearchAnswerCitation[] {
    return hits.map((hit, index) => ({
      citationId: `R${index + 1}`,
      documentId: hit.documentId,
      chunkId: hit.chunkId,
      documentName: hit.documentName,
      snippet: hit.content.slice(0, 600),
      score: hit.score,
    }));
  }
}
