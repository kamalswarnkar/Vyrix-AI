/**
 * ConversationStateManager.ts  (M14)
 *
 * Manages per-project conversation state:
 *   - Creates and lists conversations
 *   - Maintains a registry mapping conversation IDs to log file paths
 *   - Delegates message append/read to MessageStore
 *   - Handles conversation log rotation and registry persistence
 *
 * File layout per project:
 *   {projectDir}/
 *     conversations.json        — registry of all conversations
 *     conv-{id}.log             — NDJSON message log per conversation
 *
 * The registry file is a JSON object: { [convId]: ConversationMeta }
 */

import * as fs   from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { MessageStore }  from "./MessageStore";
import type {
  StoredMessage,
  Conversation,
  CreateConversationOptions,
  AppendMessageOptions,
  ReadHistoryOptions,
  ConversationRegistry,
} from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationMeta {
  id:         string;
  title:      string;
  flowId?:    string;
  logFile:    string;
  createdAt:  string;
  updatedAt:  string;
  messageCount: number;
}

// ─── ConversationStateManager ─────────────────────────────────────────────────

export class ConversationStateManager {
  private readonly store: MessageStore;

  constructor(private readonly projectDir: string) {
    this.store = new MessageStore();
  }

  // ── Registry helpers ──────────────────────────────────────────────────────

  private registryPath(): string {
    return path.join(this.projectDir, "conversations.json");
  }

  private logPath(convId: string): string {
    // Trust boundary: convId comes from the renderer over IPC — must not escape projectDir
    if (!/^[A-Za-z0-9_-]+$/.test(convId)) {
      throw new Error(`Invalid conversation id: "${convId}"`);
    }
    return path.join(this.projectDir, `conv-${convId}.log`);
  }

  private async readRegistry(): Promise<Record<string, ConversationMeta>> {
    try {
      const raw = await fs.readFile(this.registryPath(), "utf-8");
      return JSON.parse(raw) as Record<string, ConversationMeta>;
    } catch {
      return {};
    }
  }

  private async writeRegistry(registry: Record<string, ConversationMeta>): Promise<void> {
    await fs.mkdir(this.projectDir, { recursive: true });
    await fs.writeFile(this.registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Create a new conversation and register it.
   */
  async create(opts: CreateConversationOptions = {}): Promise<Conversation> {
    const id        = opts.id ?? randomUUID();
    const now       = new Date().toISOString();
    const logFile   = this.logPath(id);

    const meta: ConversationMeta = {
      id,
      title:        opts.title ?? "New Conversation",
      flowId:       opts.flowId,
      logFile,
      createdAt:    now,
      updatedAt:    now,
      messageCount: 0,
    };

    const registry = await this.readRegistry();
    registry[id]   = meta;
    await this.writeRegistry(registry);

    return this.metaToConversation(meta, []);
  }

  /**
   * Get a conversation by ID, including recent message history.
   */
  async get(convId: string, historyOpts?: ReadHistoryOptions): Promise<Conversation | null> {
    const registry = await this.readRegistry();
    const meta     = registry[convId];
    if (!meta) return null;

    const messages = await this.store.readHistory(meta.logFile, historyOpts);
    return this.metaToConversation(meta, messages);
  }

  /**
   * List all conversations for this project.
   */
  async list(): Promise<Conversation[]> {
    const registry = await this.readRegistry();
    return Object.values(registry).map((meta) =>
      this.metaToConversation(meta, []),
    );
  }

  /**
   * Append a message to a conversation.
   */
  async appendMessage(
    convId:  string,
    role:    "user" | "assistant" | "system",
    content: string,
    opts?:   AppendMessageOptions,
  ): Promise<StoredMessage | null> {
    const registry = await this.readRegistry();
    const meta     = registry[convId];
    if (!meta) return null;

    const msg = await this.store.append(meta.logFile, convId, role, content, opts);

    // Update registry metadata
    meta.updatedAt    = msg.createdAt;
    meta.messageCount += 1;
    await this.writeRegistry(registry);

    return msg;
  }

  /**
   * Read full message history for a conversation.
   */
  async readHistory(convId: string, opts?: ReadHistoryOptions): Promise<StoredMessage[]> {
    const registry = await this.readRegistry();
    const meta     = registry[convId];
    if (!meta) return [];
    return this.store.readHistory(meta.logFile, opts);
  }

  /**
   * Delete a conversation and its log file.
   */
  async delete(convId: string): Promise<boolean> {
    const registry = await this.readRegistry();
    const meta     = registry[convId];
    if (!meta) return false;

    delete registry[convId];
    await this.writeRegistry(registry);

    try {
      await fs.unlink(meta.logFile);
    } catch {
      // Log file may not exist yet
    }

    return true;
  }

  /**
   * Returns the conversation registry (title, id, timestamps) for all conversations.
   */
  async getRegistry(): Promise<ConversationRegistry> {
    const registry = await this.readRegistry();
    const result: ConversationRegistry = {};
    for (const [id, meta] of Object.entries(registry)) {
      result[id] = {
        id,
        projectId:    path.basename(this.projectDir),
        flowId:       meta.flowId,
        title:        meta.title,
        createdAt:    meta.createdAt,
        lastMessageAt: meta.updatedAt,
        messageCount:  meta.messageCount,
      };
    }
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private metaToConversation(meta: ConversationMeta, messages: StoredMessage[]): Conversation {
    return {
      id:           meta.id,
      projectId:    path.basename(this.projectDir),
      flowId:       meta.flowId,
      title:        meta.title,
      createdAt:    meta.createdAt,
      lastMessageAt: meta.updatedAt,
      messageCount:  meta.messageCount,
      messages,
    };
  }
}
