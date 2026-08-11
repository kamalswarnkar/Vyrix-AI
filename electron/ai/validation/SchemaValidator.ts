/**
 * SchemaValidator.ts
 *
 * Validates structured AI output JSON against the JSON Schemas in
 * ../schemas/. Uses ajv (Ajv) for fast validation.
 *
 * Each TaskType maps to a schema file:
 *   "interview-step"     → schemas/interview-step.schema.json
 *   "interview-plan"     → schemas/interview-plan.schema.json
 *   "memory-delta"       → schemas/memory-delta.schema.json
 *   "keyword-extraction" → schemas/keyword-extraction.schema.json
 *   "evaluation-result"  → schemas/evaluation-result.schema.json
 *   "context-resolve"    → schemas/context-resolve.schema.json
 *   "generative-ui"      → schemas/generative-ui.schema.json
 *
 * Usage:
 *   const validator = new SchemaValidator();
 *   await validator.preload();
 *   const result = validator.validate("interview-step", jsonText);
 */

import Ajv, { type ValidateFunction } from "ajv";
import * as fs   from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import type { TaskType } from "../types/ai-schemas";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid:  boolean;
  errors: string[];
  data?:  unknown;
}

export class SchemaNotFoundError extends Error {
  constructor(taskType: string) {
    super(`No schema registered for task type: "${taskType}"`);
    this.name = "SchemaNotFoundError";
  }
}

// ─── SchemaValidator ──────────────────────────────────────────────────────────

export class SchemaValidator {
  private readonly ajv       = new Ajv({ allErrors: true });
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly schemasDir: string;

  constructor(schemasDir?: string) {
    this.schemasDir = schemasDir
      ?? path.resolve(__dirname, "../schemas");
  }

  /**
   * Loads and compiles the schema for the given task type.
   * Results are cached after first load.
   */
  async load(taskType: TaskType | string): Promise<void> {
    if (this.validators.has(taskType)) return;

    const schemaPath = path.join(this.schemasDir, `${taskType}.schema.json`);
    const raw        = await fs.readFile(schemaPath, "utf-8");
    const schema     = JSON.parse(raw) as object;

    const validateFn = this.ajv.compile(schema);
    this.validators.set(taskType, validateFn);
  }

  /**
   * Pre-load every schema in the schemas directory at startup.
   */
  async preload(): Promise<void> {
    const files = readdirSync(this.schemasDir).filter((f) => f.endsWith(".schema.json"));
    await Promise.allSettled(files.map((f) => this.load(f.replace(".schema.json", ""))));
  }

  /**
   * Validate a JSON string against the schema for the given task type.
   * Parses JSON first; returns validation errors if JSON is malformed.
   *
   * The validator is loaded lazily if not yet cached.
   */
  validate(taskType: TaskType | string, jsonText: string): ValidationResult {
    // ── Parse JSON ────────────────────────────────────────────────────────
    let data: unknown;
    try {
      // Strip markdown code fences if model adds them
      const cleaned = jsonText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      data = JSON.parse(cleaned);
    } catch {
      return { valid: false, errors: [`Invalid JSON: ${jsonText.slice(0, 200)}`] };
    }

    // ── Get validator (preloaded, or lazy-loaded synchronously) ───────────
    let validateFn = this.validators.get(taskType);
    if (!validateFn) {
      try {
        const raw = readFileSync(path.join(this.schemasDir, `${taskType}.schema.json`), "utf-8");
        validateFn = this.ajv.compile(JSON.parse(raw) as object);
        this.validators.set(taskType, validateFn);
      } catch {
        // No schema file exists for this task type — pass through unvalidated
        return { valid: true, errors: [], data };
      }
    }

    // ── Run validation ────────────────────────────────────────────────────
    const valid = validateFn(data) as boolean;
    if (valid) {
      return { valid: true, errors: [], data };
    }

    const errors = (validateFn.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    );

    return { valid: false, errors, data };
  }

  /**
   * Parse and validate — returns typed result or null on failure.
   */
  parseAndValidate<T>(taskType: TaskType | string, jsonText: string): T | null {
    const result = this.validate(taskType, jsonText);
    if (!result.valid) return null;
    return result.data as T;
  }
}
