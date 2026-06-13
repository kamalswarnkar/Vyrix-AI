import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceContextRef } from "@/features/ai/contracts/chat";

const DEFAULT_MAX_FILES = 2;
const MAX_FILE_BYTES = 120_000;
const EXCERPT_CHARS = 800;
const MAX_TOTAL_EXCERPT_CHARS = 1_600;
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  "data",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".css",
  ".scss",
  ".html",
  ".sql",
  ".yml",
  ".yaml",
]);

export interface WorkspaceContextServiceDependencies {
  workspaceRoot?: string;
}

export class WorkspaceContextService {
  private readonly workspaceRoot: string;

  constructor(dependencies: WorkspaceContextServiceDependencies = {}) {
    this.workspaceRoot = path.resolve(dependencies.workspaceRoot ?? ".");
  }

  async collectContext(input: {
    rootPath?: string;
    query?: string;
    maxFiles?: number;
  }): Promise<WorkspaceContextRef[]> {
    const rootPath = this.resolveInsideWorkspace(input.rootPath ?? this.workspaceRoot);
    let files: string[];
    try {
      files = await this.listTextFiles(rootPath);
    } catch {
      return [];
    }
    const queryTerms = tokenize(input.query ?? "");
    const ranked = files
      .map((file) => ({
        path: file,
        score: scorePath(file, queryTerms),
      }))
      .filter((item) => queryTerms.length === 0 || item.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, input.maxFiles ?? DEFAULT_MAX_FILES);

    const refs: WorkspaceContextRef[] = [];
    let remainingChars = MAX_TOTAL_EXCERPT_CHARS;
    for (const item of ranked) {
      if (remainingChars <= 0) {
        break;
      }

      const content = await readFile(item.path, "utf8");
      const excerpt = content.slice(0, Math.min(EXCERPT_CHARS, remainingChars));
      refs.push({
        path: path.relative(this.workspaceRoot, item.path),
        kind: "file",
        language: languageFromPath(item.path),
        summary: `Workspace file selected for local context. Size ${content.length} chars.`,
        excerpt,
      });
      remainingChars -= excerpt.length;
    }

    return refs;
  }

  private resolveInsideWorkspace(inputPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, inputPath);
    if (resolved !== this.workspaceRoot && !resolved.startsWith(`${this.workspaceRoot}${path.sep}`)) {
      throw new Error("Workspace context path must stay inside the project root");
    }

    return resolved;
  }

  private async listTextFiles(rootPath: string): Promise<string[]> {
    const rootStats = await stat(rootPath);
    if (rootStats.isFile()) {
      return isReadableTextPath(rootPath) && rootStats.size <= MAX_FILE_BYTES
        ? [rootPath]
        : [];
    }

    const found: string[] = [];
    await this.walk(rootPath, found);
    return found;
  }

  private async walk(directory: string, found: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await this.walk(fullPath, found);
        }
        continue;
      }

      if (!entry.isFile() || !isReadableTextPath(fullPath)) {
        continue;
      }

      const fileStats = await stat(fullPath);
      if (fileStats.size <= MAX_FILE_BYTES) {
        found.push(fullPath);
      }
    }
  }
}

function isReadableTextPath(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function languageFromPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "markdown",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".yml": "yaml",
    ".yaml": "yaml",
  };

  return mapping[extension];
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 3);
}

function scorePath(filePath: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 1;
  }

  const lowerPath = filePath.toLowerCase();
  return queryTerms.reduce(
    (score, term) => score + (lowerPath.includes(term) ? 3 : 0),
    0,
  );
}
