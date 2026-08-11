/**
 * ProjectStateManager.test.ts
 * Unit tests for M01 — ProjectStateManager
 *
 * Run: npx jest electron/ai/project/ProjectStateManager.test.ts
 */

import fs   from "node:fs/promises";
import os   from "node:os";
import path from "node:path";
import { ProjectStateManager } from "./ProjectStateManager";

let storageRoot: string;
let manager:     ProjectStateManager;

beforeEach(async () => {
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vyrix-psm-test-"));
  manager     = new ProjectStateManager(storageRoot);
});

afterEach(async () => {
  await fs.rm(storageRoot, { recursive: true, force: true });
});

// ── create ────────────────────────────────────────────────────────────────────

describe("create()", () => {
  it("returns ok:true with a project id and default fields", async () => {
    const result = await manager.create({ title: "Test Project" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.data.title).toBe("Test Project");
    expect(result.data.interview_completed).toBe(false);
    expect(result.data.roadmap).toEqual([]);
  });

  it("creates project.json and settings.json on disk", async () => {
    const result = await manager.create();
    if (!result.ok) throw new Error("create() failed");

    const dir = manager.projectDir(result.data.id);
    await expect(fs.access(path.join(dir, "project.json"))).resolves.not.toThrow();
    await expect(fs.access(path.join(dir, "settings.json"))).resolves.not.toThrow();
  });

  it("creates the topics/ subdirectory", async () => {
    const result = await manager.create();
    if (!result.ok) throw new Error("create() failed");
    await expect(
      fs.access(path.join(manager.projectDir(result.data.id), "topics")),
    ).resolves.not.toThrow();
  });
});

// ── getMeta ───────────────────────────────────────────────────────────────────

describe("getMeta()", () => {
  it("returns the stored metadata", async () => {
    const created = await manager.create({ title: "Read Test", color: "#E05B5B" });
    if (!created.ok) throw new Error(created.error);

    const read = await manager.getMeta(created.data.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.title).toBe("Read Test");
    expect(read.data.color).toBe("#E05B5B");
  });

  it("returns ok:false for a non-existent project id", async () => {
    const result = await manager.getMeta("non-existent-id");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when project.json is corrupted", async () => {
    const created = await manager.create();
    if (!created.ok) throw new Error(created.error);

    const file = path.join(manager.projectDir(created.data.id), "project.json");
    await fs.writeFile(file, "{ INVALID JSON >>>", "utf8");

    const result = await manager.getMeta(created.data.id);
    expect(result.ok).toBe(false);
  });
});

// ── updateMeta ────────────────────────────────────────────────────────────────

describe("updateMeta()", () => {
  it("applies a partial patch and updates updated_at", async () => {
    const created = await manager.create({ title: "Original" });
    if (!created.ok) throw new Error(created.error);

    const originalTs = created.data.updated_at;
    await new Promise((r) => setTimeout(r, 5)); // ensure timestamp differs

    const updated = await manager.updateMeta(created.data.id, { title: "Updated" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.title).toBe("Updated");
    expect(updated.data.updated_at).not.toBe(originalTs);
  });
});

// ── completeInterview ─────────────────────────────────────────────────────────

describe("completeInterview()", () => {
  it("sets interview_completed to true and persists roadmap", async () => {
    const created = await manager.create();
    if (!created.ok) throw new Error(created.error);

    const roadmap = [
      { step: 1, title: "Hypothesis Validation", completed: false },
      { step: 2, title: "Competition Analysis",  completed: false },
    ];

    const result = await manager.completeInterview(created.data.id, roadmap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.interview_completed).toBe(true);
    expect(result.data.roadmap).toHaveLength(2);

    // Verify persisted to disk
    const reread = await manager.getMeta(created.data.id);
    expect(reread.ok && reread.data.interview_completed).toBe(true);
  });
});

// ── validate ──────────────────────────────────────────────────────────────────

describe("validate()", () => {
  it("returns empty array for a valid project", async () => {
    const created = await manager.create();
    if (!created.ok) throw new Error(created.error);
    const missing = await manager.validate(created.data.id);
    expect(missing).toEqual([]);
  });

  it("detects missing project.json", async () => {
    const created = await manager.create();
    if (!created.ok) throw new Error(created.error);
    await fs.rm(path.join(manager.projectDir(created.data.id), "project.json"));
    const missing = await manager.validate(created.data.id);
    expect(missing).toContain("project.json");
  });
});

// ── softDelete / restore ──────────────────────────────────────────────────────

describe("softDelete() / restore()", () => {
  it("sets deleted_at and clears it on restore", async () => {
    const created = await manager.create();
    if (!created.ok) throw new Error(created.error);

    await manager.softDelete(created.data.id);
    const deleted = await manager.getMeta(created.data.id);
    expect(deleted.ok && deleted.data.deleted_at).not.toBeNull();

    await manager.restore(created.data.id);
    const restored = await manager.getMeta(created.data.id);
    expect(restored.ok && restored.data.deleted_at).toBeNull();
  });
});
