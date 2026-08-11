/**
 * factories/project.factory.ts
 *
 * Test factories for ProjectMeta, ProjectSettings, and related types.
 * Use these to build test fixtures without manual object construction.
 */

import { randomUUID } from "node:crypto";
import type { ProjectMeta, ProjectSettings } from "../../project/types";

// ─── ProjectMeta factory ─────────────────────────────────────────────────────

export function buildProjectMeta(overrides: Partial<ProjectMeta> = {}): ProjectMeta {
  const now = new Date().toISOString();
  return {
    id:                 randomUUID(),
    title:              "Test Mission",
    description:        "A test mission for unit tests",
    color:              "#6366f1",
    cover_index:        0,
    folder_id:          null,
    parent_id:          null,
    starred:            0,
    deleted_at:         null,
    created_at:         now,
    updated_at:         now,
    interview_completed: false,
    roadmap:            [],
    ...overrides,
  };
}

// ─── ProjectSettings factory ──────────────────────────────────────────────────

export function buildProjectSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    ai_personality: "technical",
    language:       "en",
    ...overrides,
  };
}

// ─── Bulk factories ───────────────────────────────────────────────────────────

export function buildProjectMetaList(count: number, overrides?: Partial<ProjectMeta>): ProjectMeta[] {
  return Array.from({ length: count }, (_, i) =>
    buildProjectMeta({ title: `Mission ${i + 1}`, ...overrides }),
  );
}
