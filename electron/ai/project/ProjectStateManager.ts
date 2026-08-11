/**
 * ProjectStateManager.ts  (M01)
 *
 * Manages on-disk lifecycle of a Vyrix project:
 *   - project.json  → metadata, interview state, roadmap
 *   - settings.json → per-project user preferences
 *
 * This is the single authoritative source for project-level state.
 * All reads/writes go through this module — never access project files directly.
 *
 * Storage root is injected at construction so the module is testable
 * without touching the real filesystem.
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuidv4 } from "node:crypto";

import type {
  ProjectMeta,
  ProjectSettings,
  CreateProjectOptions,
  UpdateProjectOptions,
  ProjectResult,
  RoadmapEntry,
} from "./types";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PROJECT_COLOR = "#5B8AF0";

function defaultMeta(id: string, opts: CreateProjectOptions): ProjectMeta {
  const now = new Date().toISOString();
  return {
    id,
    title:               opts.title        ?? "Untitled Mission",
    description:         opts.description  ?? "",
    color:               opts.color        ?? DEFAULT_PROJECT_COLOR,
    cover_index:         0,
    folder_id:           opts.folder_id    ?? null,
    parent_id:           opts.parent_id    ?? null,
    starred:             0,
    deleted_at:          null,
    created_at:          now,
    updated_at:          now,
    interview_completed: false,
    roadmap:             [],
  };
}

function defaultSettings(): ProjectSettings {
  return {
    ai_personality: "casual",
    language:       "en",
  };
}

// ─── ProjectStateManager ──────────────────────────────────────────────────────

export class ProjectStateManager {
  /** Absolute path to the directory that contains all project sub-directories */
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  // ── Directory helpers ──────────────────────────────────────────────────────

  projectDir(projectId: string): string {
    return path.join(this.storageRoot, projectId);
  }

  private metaPath(projectId: string): string {
    return path.join(this.projectDir(projectId), "project.json");
  }

  private settingsPath(projectId: string): string {
    return path.join(this.projectDir(projectId), "settings.json");
  }

  // ── Scaffold ───────────────────────────────────────────────────────────────

  /**
   * Creates the full directory scaffold for a new project.
   * Idempotent — safe to call on an existing project.
   */
  async scaffold(projectId: string): Promise<void> {
    const dir = this.projectDir(projectId);
    await fs.mkdir(path.join(dir, "topics"), { recursive: true });
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /**
   * Creates a new project with default metadata and settings.
   * Returns the full ProjectMeta on success.
   */
  async create(opts: CreateProjectOptions = {}): Promise<ProjectResult<ProjectMeta>> {
    const id   = uuidv4();
    const meta = defaultMeta(id, opts);
    const settings = defaultSettings();

    try {
      await this.scaffold(id);
      await this.writeMeta(id, meta);
      await this.writeSettings(id, settings);
      return { ok: true, data: meta };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /** Reads and parses project.json for the given project ID. */
  async getMeta(projectId: string): Promise<ProjectResult<ProjectMeta>> {
    try {
      const raw = await fs.readFile(this.metaPath(projectId), "utf8");
      const meta = JSON.parse(raw) as ProjectMeta;
      return { ok: true, data: meta };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Project ${projectId} not found` };
      }
      return { ok: false, error: `Failed to read project metadata: ${String(err)}` };
    }
  }

  /** Reads and parses settings.json for the given project ID. */
  async getSettings(projectId: string): Promise<ProjectResult<ProjectSettings>> {
    try {
      const raw = await fs.readFile(this.settingsPath(projectId), "utf8");
      return { ok: true, data: JSON.parse(raw) as ProjectSettings };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Settings file missing — return defaults, don't error
        return { ok: true, data: defaultSettings() };
      }
      return { ok: false, error: `Failed to read project settings: ${String(err)}` };
    }
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Applies a partial patch to project.json.
   * Returns the updated ProjectMeta.
   */
  async updateMeta(
    projectId: string,
    patch: UpdateProjectOptions,
  ): Promise<ProjectResult<ProjectMeta>> {
    const readResult = await this.getMeta(projectId);
    if (!readResult.ok) return readResult;

    const updated: ProjectMeta = {
      ...readResult.data,
      ...patch,
      updated_at: new Date().toISOString(),
    };

    try {
      await this.writeMeta(projectId, updated);
      return { ok: true, data: updated };
    } catch (err) {
      return { ok: false, error: `Failed to update project metadata: ${String(err)}` };
    }
  }

  /** Replaces settings.json with a merged patch. */
  async updateSettings(
    projectId: string,
    patch: Partial<ProjectSettings>,
  ): Promise<ProjectResult<ProjectSettings>> {
    const readResult = await this.getSettings(projectId);
    if (!readResult.ok) return readResult;

    const updated = { ...readResult.data, ...patch };
    try {
      await this.writeSettings(projectId, updated);
      return { ok: true, data: updated };
    } catch (err) {
      return { ok: false, error: `Failed to update project settings: ${String(err)}` };
    }
  }

  // ── Interview state helpers ────────────────────────────────────────────────

  /** Marks the project's interview as complete and persists the roadmap. */
  async completeInterview(
    projectId: string,
    roadmap: RoadmapEntry[],
  ): Promise<ProjectResult<ProjectMeta>> {
    return this.updateMeta(projectId, {
      interview_completed: true,
      roadmap,
    });
  }

  /** Returns true if the project's interview has been completed. */
  async isInterviewComplete(projectId: string): Promise<boolean> {
    const result = await this.getMeta(projectId);
    return result.ok ? result.data.interview_completed : false;
  }

  /** Marks a specific roadmap step as completed. */
  async completeStep(projectId: string, stepNumber: number): Promise<ProjectResult<ProjectMeta>> {
    const readResult = await this.getMeta(projectId);
    if (!readResult.ok) return readResult;

    const roadmap = readResult.data.roadmap.map((entry) =>
      entry.step === stepNumber
        ? { ...entry, completed: true, completed_at: new Date().toISOString() }
        : entry,
    );

    return this.updateMeta(projectId, { roadmap });
  }

  // ── List ───────────────────────────────────────────────────────────────────

  /**
   * Returns metadata for every project found in the storage root.
   * Silently skips entries that fail to parse.
   */
  async listAll(): Promise<ProjectMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.storageRoot);
    } catch {
      return [];
    }

    const results = await Promise.allSettled(
      entries.map((entry) => this.getMeta(entry)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<{ ok: true; data: ProjectMeta }> =>
        r.status === "fulfilled" && r.value.ok,
      )
      .map((r) => r.value.data);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /** Soft-deletes a project by setting deleted_at in metadata. */
  async softDelete(projectId: string): Promise<ProjectResult<ProjectMeta>> {
    return this.updateMeta(projectId, { deleted_at: new Date().toISOString() } as UpdateProjectOptions & { deleted_at: string });
  }

  /** Restores a soft-deleted project. */
  async restore(projectId: string): Promise<ProjectResult<ProjectMeta>> {
    return this.updateMeta(projectId, { deleted_at: null } as UpdateProjectOptions & { deleted_at: null });
  }

  // ── Integrity check ────────────────────────────────────────────────────────

  /**
   * Validates that a project directory has all required files.
   * Returns a list of missing components (empty array = valid).
   */
  async validate(projectId: string): Promise<string[]> {
    const missing: string[] = [];
    const checks = [
      { file: this.metaPath(projectId),     label: "project.json" },
      { file: this.settingsPath(projectId), label: "settings.json" },
    ];

    for (const { file, label } of checks) {
      try {
        await fs.access(file);
      } catch {
        missing.push(label);
      }
    }
    return missing;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async writeMeta(projectId: string, meta: ProjectMeta): Promise<void> {
    await fs.writeFile(
      this.metaPath(projectId),
      JSON.stringify(meta, null, 2),
      "utf8",
    );
  }

  private async writeSettings(projectId: string, settings: ProjectSettings): Promise<void> {
    await fs.writeFile(
      this.settingsPath(projectId),
      JSON.stringify(settings, null, 2),
      "utf8",
    );
  }
}
