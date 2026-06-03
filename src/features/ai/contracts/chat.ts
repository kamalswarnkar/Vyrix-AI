export type AiProvider = "ollama";

export type AiModelId =
  | "qwen2.5:7b-instruct"
  | "qwen2.5:14b-instruct"
  | "phi3:mini"
  | "phi3:medium";

export type ConversationScope = "project" | "workspace";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatAttachmentRef {
  documentId: string;
  chunkIds?: string[];
  label?: string;
}

export interface ConversationSummary {
  id: string;
  projectId?: string;
  workspaceId?: string;
  title: string;
  scope: ConversationScope;
  model: AiModelId;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  model?: AiModelId;
  provider?: AiProvider;
  requestId?: string;
  attachmentRefs?: ChatAttachmentRef[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  createdAt: string;
}

export interface CreateConversationRequest {
  projectId?: string;
  workspaceId?: string;
  title?: string;
  scope: ConversationScope;
  model: AiModelId;
}

export interface CreateConversationResponse {
  conversation: ConversationSummary;
}

export interface CreateChatCompletionRequest {
  conversationId: string;
  projectId?: string;
  model: AiModelId;
  provider: AiProvider;
  message: string;
  attachments?: ChatAttachmentRef[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface CreateChatCompletionResponse {
  conversation: ConversationSummary;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
}

export interface StreamChatEvent {
  type:
    | "conversation.created"
    | "message.started"
    | "message.delta"
    | "message.completed"
    | "error";
  requestId: string;
  conversationId: string;
  messageId?: string;
  delta?: string;
  done?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface ProviderChatMessage {
  role: MessageRole;
  content: string;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderChatResult {
  content: string;
  usage?: ProviderUsage;
  model: string;
  latencyMs: number;
  stopReason?: string;
}

export interface StreamedProviderChunk {
  delta: string;
  done: boolean;
  model?: string;
  usage?: ProviderUsage;
  stopReason?: string;
}
