import { nanoid } from "nanoid";

import type {
  ConversationMessage,
  ConversationSummary,
  CreateChatCompletionRequest,
  CreateChatCompletionResponse,
  ProviderChatMessage,
  StreamChatEvent,
} from "@/features/ai/contracts/chat";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";
import { aiLogger } from "@/lib/observability/ai-logger";
import { ConversationNotFoundError } from "@/server/ai/errors/ai-errors";
import type { ConversationRepository } from "@/server/ai/repositories/conversation-repository";

export interface ChatServiceDependencies {
  conversationRepository: ConversationRepository;
  ollamaClient: OllamaClient;
  now?: () => Date;
}

export class ChatService {
  private readonly conversationRepository: ConversationRepository;
  private readonly ollamaClient: OllamaClient;
  private readonly now: () => Date;

  constructor(dependencies: ChatServiceDependencies) {
    this.conversationRepository = dependencies.conversationRepository;
    this.ollamaClient = dependencies.ollamaClient;
    this.now = dependencies.now ?? (() => new Date());
  }

  async createCompletion(
    input: CreateChatCompletionRequest,
  ): Promise<CreateChatCompletionResponse> {
    const requestId = nanoid();
    const conversation = await this.requireConversation(input.conversationId);
    const userMessage = await this.persistUserMessage(input, requestId);
    const history = await this.conversationRepository.listMessages(input.conversationId);

    const result = await this.ollamaClient.chat({
      model: input.model,
      messages: this.toProviderMessages(history),
      options: {
        temperature: input.temperature,
        num_predict: input.maxTokens,
      },
    });

    const assistantMessage = await this.conversationRepository.insertMessage({
      id: nanoid(),
      conversationId: input.conversationId,
      role: "assistant",
      content: result.content,
      model: input.model,
      provider: input.provider,
      requestId,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
      latencyMs: result.latencyMs,
    });

    await this.conversationRepository.touchConversation(
      input.conversationId,
      this.now().toISOString(),
    );

    aiLogger.info({
      event: "ai.chat.completed",
      requestId,
      conversationId: input.conversationId,
      model: input.model,
      provider: input.provider,
      latencyMs: result.latencyMs,
    });

    return {
      conversation,
      userMessage,
      assistantMessage,
    };
  }

  async streamCompletion(
    input: CreateChatCompletionRequest,
  ): Promise<ReadableStream<Uint8Array>> {
    const encoder = new TextEncoder();
    const requestId = nanoid();
    await this.requireConversation(input.conversationId);
    await this.persistUserMessage(input, requestId);
    const history = await this.conversationRepository.listMessages(input.conversationId);
    const assistantMessageId = nanoid();
    const startedAt = Date.now();

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let fullContent = "";
        const send = (event: StreamChatEvent) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        };

        try {
          send({
            type: "message.started",
            requestId,
            conversationId: input.conversationId,
            messageId: assistantMessageId,
          });

          for await (const chunk of this.ollamaClient.streamChat({
            model: input.model,
            messages: this.toProviderMessages(history),
            options: {
              temperature: input.temperature,
              num_predict: input.maxTokens,
            },
          })) {
            if (chunk.delta) {
              fullContent += chunk.delta;
              send({
                type: "message.delta",
                requestId,
                conversationId: input.conversationId,
                messageId: assistantMessageId,
                delta: chunk.delta,
              });
            }

            if (chunk.done) {
              await this.conversationRepository.insertMessage({
                id: assistantMessageId,
                conversationId: input.conversationId,
                role: "assistant",
                content: fullContent,
                model: input.model,
                provider: input.provider,
                requestId,
                promptTokens: chunk.usage?.promptTokens,
                completionTokens: chunk.usage?.completionTokens,
                totalTokens: chunk.usage?.totalTokens,
                latencyMs: Date.now() - startedAt,
              });

              await this.conversationRepository.touchConversation(
                input.conversationId,
                this.now().toISOString(),
              );

              aiLogger.info({
                event: "ai.chat.stream.completed",
                requestId,
                conversationId: input.conversationId,
                model: input.model,
                provider: input.provider,
                latencyMs: Date.now() - startedAt,
              });

              send({
                type: "message.completed",
                requestId,
                conversationId: input.conversationId,
                messageId: assistantMessageId,
                done: true,
              });
            }
          }

          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown streaming error";

          aiLogger.error({
            event: "ai.chat.stream.failed",
            requestId,
            conversationId: input.conversationId,
            model: input.model,
            provider: input.provider,
            details: { message },
          });

          send({
            type: "error",
            requestId,
            conversationId: input.conversationId,
            error: {
              code: "OLLAMA_STREAM_FAILED",
              message,
            },
          });
          controller.close();
        }
      },
    });
  }

  private async requireConversation(
    conversationId: string,
  ): Promise<ConversationSummary> {
    const conversation = await this.conversationRepository.getConversation(
      conversationId,
    );

    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    return conversation;
  }

  private async persistUserMessage(
    input: CreateChatCompletionRequest,
    requestId: string,
  ): Promise<ConversationMessage> {
    return this.conversationRepository.insertMessage({
      id: nanoid(),
      conversationId: input.conversationId,
      role: "user",
      content: input.message,
      model: input.model,
      provider: input.provider,
      requestId,
    });
  }

  private toProviderMessages(messages: ConversationMessage[]): ProviderChatMessage[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }
}
