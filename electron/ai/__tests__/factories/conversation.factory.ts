/**
 * factories/conversation.factory.ts
 *
 * Test factories for StoredMessage and Conversation objects.
 */

import { randomUUID } from "node:crypto";
import type { StoredMessage, Conversation } from "../../conversation/types";

// ─── StoredMessage factory ────────────────────────────────────────────────────

export function buildStoredMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id:             randomUUID(),
    conversationId: randomUUID(),
    role:           "user",
    content:        "Test message content",
    createdAt:      new Date().toISOString(),
    ...overrides,
  };
}

export function buildMessagePair(
  userContent:      string,
  assistantContent: string,
  conversationId?:  string,
): [StoredMessage, StoredMessage] {
  const convId = conversationId ?? randomUUID();
  const ts1    = new Date(Date.now() - 1000).toISOString();
  const ts2    = new Date().toISOString();
  return [
    buildStoredMessage({ role: "user",      content: userContent,      conversationId: convId, createdAt: ts1 }),
    buildStoredMessage({ role: "assistant", content: assistantContent, conversationId: convId, createdAt: ts2 }),
  ];
}

// ─── Conversation factory ─────────────────────────────────────────────────────

export function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date().toISOString();
  return {
    id:            randomUUID(),
    projectId:     randomUUID(),
    flowId:        undefined,
    title:         "Test Conversation",
    createdAt:     now,
    lastMessageAt: now,
    messageCount:  0,
    messages:      [],
    ...overrides,
  };
}
