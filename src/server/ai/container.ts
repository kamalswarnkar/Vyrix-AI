import { getAiConfig } from "@/server/ai/config/ai-config";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";
import { ChatService } from "@/server/ai/services/chat-service";
import { AiHealthService } from "@/server/ai/services/ai-health-service";
import { SqliteConversationRepository } from "@/server/ai/repositories/sqlite-conversation-repository";
import { SqliteDocumentRepository } from "@/server/ai/repositories/sqlite-document-repository";
import { SqliteVectorRepository } from "@/server/ai/repositories/sqlite-vector-repository";
import { DocumentService } from "@/server/ai/services/document-service";
import { EmbeddingService } from "@/server/ai/services/embedding-service";
import { FaissIndexService } from "@/server/ai/services/faiss-index-service";
import { RetrievalService } from "@/server/ai/services/retrieval-service";
import { WorkspaceContextService } from "@/server/ai/services/workspace-context-service";
import { getSqliteClient } from "@/server/db/sqlite/client";

export interface AiContainer {
  chatService: ChatService;
  aiHealthService: AiHealthService;
  conversationRepository: SqliteConversationRepository;
  documentRepository: SqliteDocumentRepository;
  vectorRepository: SqliteVectorRepository;
  faissIndexService: FaissIndexService;
  documentService: DocumentService;
  embeddingService: EmbeddingService;
  retrievalService: RetrievalService;
  workspaceContextService: WorkspaceContextService;
}

let aiContainer: AiContainer | null = null;

export function getAiContainer(): AiContainer {
  if (!aiContainer) {
    const config = getAiConfig();
    const sqlite = getSqliteClient(config.sqlitePath);
    const ollamaClient = new OllamaClient({
      baseUrl: config.ollamaBaseUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs,
    });
    const conversationRepository = new SqliteConversationRepository(sqlite);
    const documentRepository = new SqliteDocumentRepository(sqlite);
    const faissIndexService = new FaissIndexService(config.faissIndexDir);
    const vectorRepository = new SqliteVectorRepository(sqlite, faissIndexService);
    const embeddingService = new EmbeddingService({
      ollamaClient,
      vectorRepository,
      embeddingModel: config.embeddingModel,
    });
    const retrievalService = new RetrievalService({
      documentRepository,
      vectorRepository,
      embeddingService,
    });
    const workspaceContextService = new WorkspaceContextService({
      workspaceRoot: config.workspaceRoot,
    });

    aiContainer = {
      chatService: new ChatService({
        conversationRepository,
        ollamaClient,
        retrievalService,
        workspaceContextService,
        historyMessageLimit: config.chatHistoryMessageLimit,
      }),
      aiHealthService: new AiHealthService({
        ollamaClient,
        baseUrl: config.ollamaBaseUrl,
        defaultChatModel: config.defaultChatModel,
      }),
      conversationRepository,
      documentRepository,
      vectorRepository,
      faissIndexService,
      documentService: new DocumentService({
        documentRepository,
        vectorRepository,
        embeddingService,
        storageRoot: config.uploadStorageRoot,
      }),
      embeddingService,
      retrievalService,
      workspaceContextService,
    };
  }

  return aiContainer;
}
