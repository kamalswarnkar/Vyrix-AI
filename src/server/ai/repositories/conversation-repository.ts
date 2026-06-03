import type {
  ConversationMessage,
  ConversationSummary,
} from "@/features/ai/contracts/chat";

export interface CreateConversationRecordInput {
  id: string;
  projectId?: string;
  workspaceId?: string;
  title: string;
  scope: "project" | "workspace";
  model: string;
}

export interface InsertMessageInput {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  model?: string;
  provider?: string;
  requestId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

export interface ConversationRepository {
  createConversation(input: CreateConversationRecordInput): Promise<ConversationSummary>;
  listConversationsByProject(projectId: string): Promise<ConversationSummary[]>;
  getConversation(conversationId: string): Promise<ConversationSummary | null>;
  listMessages(conversationId: string): Promise<ConversationMessage[]>;
  insertMessage(input: InsertMessageInput): Promise<ConversationMessage>;
  touchConversation(conversationId: string, updatedAt: string): Promise<void>;
}
