import { nanoid } from "nanoid";

import type {
  ChatAttachmentRef,
  ChatContextSelection,
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
import type { RetrievalService } from "@/server/ai/services/retrieval-service";
import type { WorkspaceContextService } from "@/server/ai/services/workspace-context-service";

export interface ChatServiceDependencies {
  conversationRepository: ConversationRepository;
  ollamaClient: OllamaClient;
  retrievalService?: RetrievalService;
  workspaceContextService?: WorkspaceContextService;
  historyMessageLimit?: number;
  now?: () => Date;
}

const RESEARCH_ASSISTANT_SYSTEM_PROMPT = [
  "You are Vyrix, a local research assistant for PhD and research students.",
  "Help with literature review, paper understanding, research planning, critical analysis, experiment design, methodology review, writing structure, and workspace-aware project reasoning.",
  "Use the supplied workspace and uploaded-file context when it is relevant. If context is missing, outdated, or insufficient, say what is missing instead of inventing sources.",
  "When discussing uploaded PDFs or images, distinguish between extracted text, visual descriptions, and user-provided summaries. Do not claim to have read image pixels or PDF pages unless that extracted context is present.",
  "Prefer precise, evidence-grounded answers with citations to provided document names, paths, chunks, or excerpts when available.",
].join("\n");

export class ChatService {
  private readonly conversationRepository: ConversationRepository;
  private readonly ollamaClient: OllamaClient;
  private readonly retrievalService?: RetrievalService;
  private readonly workspaceContextService?: WorkspaceContextService;
  private readonly historyMessageLimit: number;
  private readonly now: () => Date;

  constructor(dependencies: ChatServiceDependencies) {
    this.conversationRepository = dependencies.conversationRepository;
    this.ollamaClient = dependencies.ollamaClient;
    this.retrievalService = dependencies.retrievalService;
    this.workspaceContextService = dependencies.workspaceContextService;
    this.historyMessageLimit = dependencies.historyMessageLimit ?? 20;
    this.now = dependencies.now ?? (() => new Date());
  }

  async createCompletion(
    input: CreateChatCompletionRequest,
  ): Promise<CreateChatCompletionResponse> {
    const requestId = nanoid();
    const conversation = await this.requireConversation(input.conversationId);
    const userMessage = await this.persistUserMessage(input, requestId);
    const history = await this.getRecentHistory(input.conversationId);
    const context = await this.enrichContext(input);

    const result = await this.ollamaClient.chat({
      model: input.model,
      messages: this.buildProviderMessages(history, input, context),
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
    const history = await this.getRecentHistory(input.conversationId);
    const context = await this.enrichContext(input);
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
            messages: this.buildProviderMessages(history, input, context),
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

  private buildProviderMessages(
    messages: ConversationMessage[],
    input: CreateChatCompletionRequest,
    context: ChatContextSelection | undefined,
  ): ProviderChatMessage[] {
    const contextMessage = this.buildContextMessage(
      context,
      input.attachments,
    );

    return [
      {
        role: "system",
        content: contextMessage
          ? `${RESEARCH_ASSISTANT_SYSTEM_PROMPT}\n\n${contextMessage}`
          : RESEARCH_ASSISTANT_SYSTEM_PROMPT,
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
  }

  private async getRecentHistory(conversationId: string): Promise<ConversationMessage[]> {
    const messages = await this.conversationRepository.listMessages(conversationId);
    return messages.slice(-this.historyMessageLimit);
  }

  private async enrichContext(
    input: CreateChatCompletionRequest,
  ): Promise<ChatContextSelection | undefined> {
    let context = input.context;

    if (context?.includeWorkspace && this.workspaceContextService) {
      const workspaceRefs = await this.workspaceContextService.collectContext({
        query: context.retrievalQuery ?? input.message,
        maxFiles: Math.min(context.topK ?? 8, 20),
      });
      context = {
        ...context,
        workspaceRefs: [...(context.workspaceRefs ?? []), ...workspaceRefs],
      };
    }

    if (input.projectId && this.retrievalService) {
      context = await this.retrievalService.buildChatContext({
        projectId: input.projectId,
        query: context?.retrievalQuery ?? input.message,
        topK: context?.topK ?? 6,
        existingContext: context,
      });
    }

    return context;
  }

  private buildContextMessage(
    context?: ChatContextSelection,
    legacyAttachments: ChatAttachmentRef[] = [],
  ): string | null {
    const sections: string[] = [];
    const workspaceRefs = context?.workspaceRefs ?? [];
    const attachments = [
      ...legacyAttachments,
      ...(context?.attachmentRefs ?? []),
    ];

    if (context?.includeWorkspace) {
      sections.push(
        "Workspace awareness requested. Use supplied workspace excerpts as the source of truth; ask for more context when the needed file or folder is not included.",
      );
    }

    if (workspaceRefs.length > 0) {
      sections.push(
        [
          "Workspace context:",
          ...workspaceRefs.map((ref, index) => {
            const lines = [
              `${index + 1}. ${ref.kind}: ${ref.path}`,
              ref.language ? `Language: ${ref.language}` : undefined,
              ref.summary ? `Summary: ${ref.summary}` : undefined,
              ref.excerpt ? `Excerpt:\n${ref.excerpt}` : undefined,
            ].filter(Boolean);

            return lines.join("\n");
          }),
        ].join("\n\n"),
      );
    }

    if (attachments.length > 0) {
      sections.push(
        [
          "Uploaded or retrieved source references:",
          ...attachments.map((attachment, index) => {
            const label = attachment.label ? ` (${attachment.label})` : "";
            const kind = attachment.kind ? ` [${attachment.kind}]` : "";
            const chunks = attachment.chunkIds?.length
              ? ` chunks=${attachment.chunkIds.join(", ")}`
              : "";
            const summary = attachment.summary
              ? `\nSummary: ${attachment.summary}`
              : "";

            return `${index + 1}. ${attachment.documentId}${label}${kind}${chunks}${summary}`;
          }),
        ].join("\n"),
      );
    }

    if (context?.retrievalQuery) {
      sections.push(`Retrieval query: ${context.retrievalQuery}`);
    }

    return sections.length > 0
      ? `Available context for this turn:\n\n${sections.join("\n\n")}`
      : null;
  }
}
