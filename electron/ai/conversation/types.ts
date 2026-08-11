/**
 * types.ts — Conversation module type definitions
 */

// ─── Message ──────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface StoredMessage {
  id:             string;
  conversationId: string;
  role:           MessageRole;
  content:        string;
  model?:         string;
  latencyMs?:     number;
  createdAt:      string; // ISO 8601
}

// ─── Conversation ─────────────────────────────────────────────────────────────

export type ConversationScope = "workspace" | "project";

export interface Conversation {
  id:            string;
  projectId?:    string;     // undefined for workspace-scoped conversations
  flowId?:       string;
  title:         string;
  messageCount:  number;
  lastMessageAt: string;     // ISO 8601
  createdAt:     string;     // ISO 8601
  messages?:     StoredMessage[];
}

/** Registry summaries keyed by conversation id (matches getRegistry() output) */
export type ConversationRegistry = Record<string, Omit<Conversation, "messages">>;

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CreateConversationOptions {
  id?:        string;
  projectId?: string;
  flowId?:    string;
  title?:     string;
  scope?:     ConversationScope;
  model?:     string;
}

export interface AppendMessageOptions {
  model?:     string;
  latencyMs?: number;
}

export interface ReadHistoryOptions {
  /** Maximum number of turns (user+assistant pairs) to return. Default: 10 */
  maxTurns?: number;
}
