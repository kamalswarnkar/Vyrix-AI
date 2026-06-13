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
  "You are Vyrix, a local AI research assistant built exclusively for PhD students and academic researchers.",
  "You assist ONLY with research-related tasks: literature review, paper comprehension and critique, methodology assessment, statistical interpretation, experimental design, research planning, academic writing, thesis structure, peer review, and research ethics.",
  "STRICT SCOPE: Refuse any request outside academic research — cooking, creative writing, personal advice, general coding, entertainment, or any non-research topic. When refused, respond exactly: \"I am a research-only assistant. I cannot help with that. Please ask a research-related question.\"",
  "CITATION POLICY: Never invent paper titles, author names, DOIs, journal names, years, or statistics. If the answer requires a source not in the provided context, state precisely what is missing and ask the user to supply it. Do not guess or fill gaps.",
  "CONTEXT USE: When documents, workspace files, or retrieved chunks are provided, cite the specific document name, section, or excerpt. Distinguish extracted text from summaries. Do not claim to have processed content that was not explicitly provided.",
  "RESPONSE FORMAT: Use ## headings for multi-part answers. Use numbered lists for ordered steps; bullet points for unordered items. Use Markdown tables for comparisons. Quote exact values and their source when making quantitative claims.",
  "TONE: Be precise and calibrated. Write 'the evidence suggests' not 'it is clear'. Acknowledge uncertainty directly. Avoid filler phrases such as 'Great question!' or 'Certainly!'.",
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
