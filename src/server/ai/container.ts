import { getAiConfig } from "@/server/ai/config/ai-config";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";
import { ChatService } from "@/server/ai/services/chat-service";
import { AiHealthService } from "@/server/ai/services/ai-health-service";
import { SqliteConversationRepository } from "@/server/ai/repositories/sqlite-conversation-repository";
import { SqliteDocumentRepository } from "@/server/ai/repositories/sqlite-document-repository";
import { DocumentService } from "@/server/ai/services/document-service";
import { RetrievalService } from "@/server/ai/services/retrieval-service";
import { WorkspaceContextService } from "@/server/ai/services/workspace-context-service";
import { getSqliteClient } from "@/server/db/sqlite/client";

export interface AiContainer {
  chatService: ChatService;
  aiHealthService: AiHealthService;
  conversationRepository: SqliteConversationRepository;
  documentRepository: SqliteDocumentRepository;
  documentService: DocumentService;
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
    });
    const conversationRepository = new SqliteConversationRepository(sqlite);
    const documentRepository = new SqliteDocumentRepository(sqlite);
    const retrievalService = new RetrievalService({
      documentRepository,
    });
    const workspaceContextService = new WorkspaceContextService();

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
      documentService: new DocumentService({
        documentRepository,
      }),
      retrievalService,
      workspaceContextService,
    };
  }

  return aiContainer;
}
