/**
 * ConversationStateManager.test.ts
 * Unit tests for M14 — ConversationStateManager
 */

import * as fs   from "node:fs/promises";
import * as os   from "node:os";
import * as path from "node:path";
import { ConversationStateManager } from "./ConversationStateManager";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vyrix-csm-"));
}

describe("ConversationStateManager", () => {
  let tempDir: string;
  let mgr: ConversationStateManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    mgr     = new ConversationStateManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("create() returns a Conversation with generated id", async () => {
    const conv = await mgr.create({ title: "Test Conversation" });
    expect(conv.id).toBeTruthy();
    expect(conv.title).toBe("Test Conversation");
    expect(conv.messageCount).toBe(0);
  });

  it("create() persists to registry", async () => {
    const conv1 = await mgr.create({ title: "Conv 1" });
    const conv2 = await mgr.create({ title: "Conv 2" });
    const list  = await mgr.list();
    const ids   = list.map((c) => c.id);
    expect(ids).toContain(conv1.id);
    expect(ids).toContain(conv2.id);
  });

  it("get() returns null for unknown conversation", async () => {
    const result = await mgr.get("nonexistent-id");
    expect(result).toBeNull();
  });

  it("get() returns conversation after creation", async () => {
    const conv    = await mgr.create({ title: "My Conv" });
    const fetched = await mgr.get(conv.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("My Conv");
  });

  it("appendMessage() adds a message and updates registry", async () => {
    const conv = await mgr.create();
    const msg  = await mgr.appendMessage(conv.id, "user", "Hello from user");
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe("Hello from user");
    expect(msg!.role).toBe("user");

    const list = await mgr.list();
    const updated = list.find((c) => c.id === conv.id)!;
    expect(updated.messageCount).toBe(1);
  });

  it("readHistory() returns messages in order", async () => {
    const conv = await mgr.create();
    await mgr.appendMessage(conv.id, "user",      "First");
    await mgr.appendMessage(conv.id, "assistant", "Second");
    await mgr.appendMessage(conv.id, "user",      "Third");

    const history = await mgr.readHistory(conv.id);
    expect(history).toHaveLength(3);
    expect(history[0]!.content).toBe("First");
    expect(history[2]!.content).toBe("Third");
  });

  it("delete() removes conversation from registry", async () => {
    const conv = await mgr.create({ title: "To Delete" });
    await mgr.appendMessage(conv.id, "user", "Some message");

    const deleted = await mgr.delete(conv.id);
    expect(deleted).toBe(true);

    const result = await mgr.get(conv.id);
    expect(result).toBeNull();
  });

  it("delete() returns false for non-existent conversation", async () => {
    const deleted = await mgr.delete("no-such-id");
    expect(deleted).toBe(false);
  });

  it("getRegistry() returns metadata for all conversations", async () => {
    await mgr.create({ title: "Alpha" });
    await mgr.create({ title: "Beta" });
    const registry = await mgr.getRegistry();
    const titles   = Object.values(registry).map((c) => c.title);
    expect(titles).toContain("Alpha");
    expect(titles).toContain("Beta");
  });

  it("create() accepts flowId", async () => {
    const conv = await mgr.create({ title: "Scoped", flowId: "flow-abc" });
    const fetched = await mgr.get(conv.id);
    expect(fetched!.flowId).toBe("flow-abc");
  });
});
