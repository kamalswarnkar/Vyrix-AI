import type Database from "better-sqlite3";

import type {
  ConversationMessage,
  ConversationSummary,
} from "@/features/ai/contracts/chat";
import type {
  ConversationRepository,
  CreateConversationRecordInput,
  InsertMessageInput,
} from "@/server/ai/repositories/conversation-repository";

interface ConversationRow {
  id: string;
  project_id: string | null;
  workspace_id: string | null;
  title: string;
  scope: "project" | "workspace";
  model: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  model: string | null;
  provider: string | null;
  request_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database.Database) {}

  async createConversation(
    input: CreateConversationRecordInput,
  ): Promise<ConversationSummary> {
    const now = new Date().toISOString();

    if (input.projectId) {
      this.db
        .prepare(
          `
            INSERT OR IGNORE INTO projects (
              id, workspace_id, name, created_at, updated_at
            ) VALUES (
              @id, @workspace_id, @name, @created_at, @updated_at
            )
          `,
        )
        .run({
          id: input.projectId,
          workspace_id: input.workspaceId ?? null,
          name: input.projectId,
          created_at: now,
          updated_at: now,
        });
    }

    this.db
      .prepare(
        `
          INSERT INTO conversations (
            id, project_id, workspace_id, title, scope, model, last_message_at, created_at, updated_at
          ) VALUES (
            @id, @project_id, @workspace_id, @title, @scope, @model, @last_message_at, @created_at, @updated_at
          )
        `,
      )
      .run({
        id: input.id,
        project_id: input.projectId ?? null,
        workspace_id: input.workspaceId ?? null,
        title: input.title,
        scope: input.scope,
        model: input.model,
        last_message_at: now,
        created_at: now,
        updated_at: now,
      });

    const conversation = await this.getConversation(input.id);
    if (!conversation) {
      throw new Error("Conversation creation failed");
    }

    return conversation;
  }

  async listConversationsByProject(projectId: string): Promise<ConversationSummary[]> {
    const rows = this.db
      .prepare(
        `
          SELECT
            c.*,
            COUNT(m.id) AS message_count
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.project_id = ?
          GROUP BY c.id
          ORDER BY c.updated_at DESC
        `,
      )
      .all(projectId) as ConversationRow[];

    return rows.map((row) => this.mapConversation(row));
  }

  async getConversation(conversationId: string): Promise<ConversationSummary | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            c.*,
            COUNT(m.id) AS message_count
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.id = ?
          GROUP BY c.id
        `,
      )
      .get(conversationId) as ConversationRow | undefined;

    return row ? this.mapConversation(row) : null;
  }

  async listMessages(conversationId: string): Promise<ConversationMessage[]> {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(conversationId) as MessageRow[];

    return rows.map((row) => this.mapMessage(row));
  }

  async insertMessage(input: InsertMessageInput): Promise<ConversationMessage> {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO messages (
            id, conversation_id, role, content, model, provider, request_id,
            prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at
          ) VALUES (
            @id, @conversation_id, @role, @content, @model, @provider, @request_id,
            @prompt_tokens, @completion_tokens, @total_tokens, @latency_ms, @created_at
          )
        `,
      )
      .run({
        id: input.id,
        conversation_id: input.conversationId,
        role: input.role,
        content: input.content,
        model: input.model ?? null,
        provider: input.provider ?? null,
        request_id: input.requestId ?? null,
        prompt_tokens: input.promptTokens ?? null,
        completion_tokens: input.completionTokens ?? null,
        total_tokens: input.totalTokens ?? null,
        latency_ms: input.latencyMs ?? null,
        created_at: createdAt,
      });

    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(input.id) as MessageRow;

    return this.mapMessage(row);
  }

  async touchConversation(conversationId: string, updatedAt: string): Promise<void> {
    this.db
      .prepare(
        `
          UPDATE conversations
          SET updated_at = ?, last_message_at = ?
          WHERE id = ?
        `,
      )
      .run(updatedAt, updatedAt, conversationId);
  }

  private mapConversation(row: ConversationRow): ConversationSummary {
    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      title: row.title,
      scope: row.scope,
      model: row.model as ConversationSummary["model"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count ?? 0,
    };
  }

  private mapMessage(row: MessageRow): ConversationMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      model: (row.model ?? undefined) as ConversationMessage["model"],
      provider: (row.provider ?? undefined) as ConversationMessage["provider"],
      requestId: row.request_id ?? undefined,
      promptTokens: row.prompt_tokens ?? undefined,
      completionTokens: row.completion_tokens ?? undefined,
      totalTokens: row.total_tokens ?? undefined,
      latencyMs: row.latency_ms ?? undefined,
      createdAt: row.created_at,
    };
  }
}
