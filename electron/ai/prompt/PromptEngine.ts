/**
 * PromptEngine.ts  (M13)
 *
 * High-level orchestrator for a single inference turn.
 * Wires together:
 *   PromptCompiler  → assembles message array
 *   GrammarRegistry → loads GBNF grammar (if taskType provided)
 *   ModelRouter     → dispatches to sidecar or Ollama
 *   SchemaValidator → validates structured JSON output
 *
 * This is the primary entry point for all AI feature modules
 * (Interview Engine, Planning Engine, Memory Distillation, etc.).
 *
 * Usage:
 *   const engine = new PromptEngine(compiler, grammar, router, validator);
 *   const result = await engine.run({ systemPrompt, userMessage, taskType: "interview-step" });
 */

import { PromptCompiler }   from "./PromptCompiler";
import { GrammarRegistry }  from "./GrammarRegistry";
import { ModelRouter }      from "../core/ModelRouter";
import { SchemaValidator }  from "../validation/SchemaValidator";
import type {
  PromptEngineRequest,
  PromptEngineResponse,
  PromptEngineStreamCallback,
  PromptEngineDoneCallback,
  PromptEngineErrorCallback,
} from "./types";

// ─── PromptEngine ─────────────────────────────────────────────────────────────

export class PromptEngine {
  constructor(
    private readonly compiler:   PromptCompiler,
    private readonly grammar:    GrammarRegistry,
    private readonly router:     ModelRouter,
    private readonly validator:  SchemaValidator,
  ) {}

  /**
   * Execute a non-streaming inference turn.
   * Parses and validates JSON output if taskType is provided.
   */
  async run(req: PromptEngineRequest): Promise<PromptEngineResponse> {
    const start = Date.now();

    // ── 1. Resolve grammar ────────────────────────────────────────────────
    let grammarStr = req.grammar;
    if (!grammarStr && req.taskType) {
      grammarStr = await this.grammar.get(req.taskType).catch(() => undefined);
    }

    // ── 2. Compile prompt ─────────────────────────────────────────────────
    const compiled = this.compiler.compile({
      systemPrompt:   req.systemPrompt,
      history:        req.history ?? [],
      userMessage:    req.userMessage,
      contextBlock:   req.contextBlock,
      grammar:        grammarStr,
      taskType:       req.taskType,
      maxHistoryTurns: req.maxHistoryTurns,
    });

    // ── 3. Run inference ──────────────────────────────────────────────────
    let text: string;
    try {
      const response = await this.router.complete({
        messages: compiled.messages,
        grammar:  compiled.grammar,
      });
      text = response.content;
    } catch (err) {
      return { ok: false, error: String(err) };
    }

    const latencyMs = Date.now() - start;

    // ── 4. Validate structured output ─────────────────────────────────────
    if (req.taskType) {
      const validation = this.validator.validate(req.taskType, text);
      if (!validation.valid) {
        return {
          ok:    false,
          error: `Schema validation failed for ${req.taskType}: ${validation.errors.join("; ")}`,
          text,
          latencyMs,
        };
      }
    }

    return {
      ok: true,
      text,
      tokens:    compiled.estimatedTokens,
      latencyMs,
    };
  }

  /**
   * Execute a streaming inference turn.
   * Structured JSON validation happens on the complete accumulated text
   * in the onDone callback.
   */
  async stream(
    req:      PromptEngineRequest,
    onChunk:  PromptEngineStreamCallback,
    onDone:   PromptEngineDoneCallback,
    onError:  PromptEngineErrorCallback,
  ): Promise<void> {
    // ── 1. Resolve grammar ────────────────────────────────────────────────
    let grammarStr = req.grammar;
    if (!grammarStr && req.taskType) {
      grammarStr = await this.grammar.get(req.taskType).catch(() => undefined);
    }

    // ── 2. Compile prompt ─────────────────────────────────────────────────
    const compiled = this.compiler.compile({
      systemPrompt:    req.systemPrompt,
      history:         req.history ?? [],
      userMessage:     req.userMessage,
      contextBlock:    req.contextBlock,
      grammar:         grammarStr,
      taskType:        req.taskType,
      maxHistoryTurns: req.maxHistoryTurns,
    });

    // ── 3. Stream inference ───────────────────────────────────────────────
    // Attach images to the final user message (Qwen2.5-VL multimodal path)
    const messages = compiled.messages as Array<{ role: string; content: string; images?: string[] }>;
    if (req.images?.length) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) lastUser.images = req.images;
    }

    await this.router.stream(
      { messages: compiled.messages, grammar: compiled.grammar },
      {
        onChunk,
        onDone: (full, latencyMs) => {
          // Post-stream validation for structured types
          if (req.taskType) {
            const validation = this.validator.validate(req.taskType, full);
            if (!validation.valid) {
              onError(`Schema validation failed: ${validation.errors.join("; ")}`);
              return;
            }
          }
          onDone(full, latencyMs);
        },
        onError,
      },
    );
  }
}
