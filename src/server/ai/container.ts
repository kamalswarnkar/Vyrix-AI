import { getAiConfig } from "@/server/ai/config/ai-config";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";
import { ChatService } from "@/server/ai/services/chat-service";
import { AiHealthService } from "@/server/ai/services/ai-health-service";
import { SqliteConversationRepository } from "@/server/ai/repositories/sqlite-conversation-repository";
import { getSqliteClient } from "@/server/db/sqlite/client";

export interface AiContainer {
  chatService: ChatService;
  aiHealthService: AiHealthService;
  conversationRepository: SqliteConversationRepository;
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

    aiContainer = {
      chatService: new ChatService({
        conversationRepository,
        ollamaClient,
      }),
      aiHealthService: new AiHealthService({
        ollamaClient,
        baseUrl: config.ollamaBaseUrl,
        defaultChatModel: config.defaultChatModel,
      }),
      conversationRepository,
    };
  }

  return aiContainer;
}
