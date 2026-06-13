export type AiProvider = "ollama";

export type AiModelId = "llama3.2:3b-instruct";

export type ConversationScope = "project" | "workspace";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatAttachmentRef {
  documentId: string;
  chunkIds?: string[];
  label?: string;
  kind?: "pdf" | "image" | "text" | "workspace";
  summary?: string;
}

export interface WorkspaceContextRef {
  path: string;
  kind: "file" | "directory";
  language?: string;
  summary?: string;
  excerpt?: string;
}

export interface ChatContextSelection {
  includeWorkspace?: boolean;
  workspaceRefs?: WorkspaceContextRef[];
  attachmentRefs?: ChatAttachmentRef[];
  retrievalQuery?: string;
  topK?: number;
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
  context?: ChatContextSelection;
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
