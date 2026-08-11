/**
 * ContextInjector.ts  (M16)
 *
 * Resolves which project context to inject into a chat session.
 * When the user's message doesn't explicitly specify a project,
 * this module uses the PromptEngine to infer the most relevant project
 * from the user's message content.
 *
 * Once a project is identified, ContextBuilder assembles the context
 * block ready for system prompt injection.
 *
 * Usage:
 *   const injector = new ContextInjector(promptEngine, validator, contextBuilder, projectStateMgr);
 *   const result   = await injector.resolve({ message, storageRoot });
 */

import { ContextBuilder }       from "./ContextBuilder";
import { PromptEngine }         from "../prompt/PromptEngine";
import { SchemaValidator }      from "../validation/SchemaValidator";
import { ProjectStateManager }  from "../project/ProjectStateManager";
import { MemoryEngine }         from "../memory/MemoryEngine";
import { contextResolvePrompt } from "../prompt/templates/planning";
import type { ContextInjectResult, ContextResolveOptions } from "./types";
import type { ContextResolveResult } from "../types/ai-schemas";

// ─── ContextInjector ──────────────────────────────────────────────────────────

export class ContextInjector {
  constructor(
    private readonly promptEngine:    PromptEngine,
    private readonly validator:       SchemaValidator,
    private readonly contextBuilder:  ContextBuilder,
    private readonly projectState:    ProjectStateManager,
  ) {}

  /**
   * Resolve the context for the given message.
   * Returns a ContextInjectResult with the assembled context string.
   */
  async resolve(opts: ContextResolveOptions): Promise<ContextInjectResult> {
    const { message, storageRoot } = opts;

    // ── 1. List available projects ─────────────────────────────────────────
    const allProjects = await this.projectState.listAll();
    if (allProjects.length === 0) {
      return { ok: true, hasContext: false, context: "" };
    }

    // ── 2. Resolve which project is relevant ──────────────────────────────
    const resolveResult = await this.promptEngine.run({
      systemPrompt: "You are a context resolver. Analyse the user message and determine which project it relates to.",
      userMessage:  contextResolvePrompt({
        message,
        projects: allProjects.map((p) => ({
          id:          p.id,
          title:       p.title,
          description: p.description,
        })),
      }),
      taskType: "context-resolve",
    });

    if (!resolveResult.ok || !resolveResult.text) {
      return { ok: false, hasContext: false, context: "", error: resolveResult.error };
    }

    const resolved = this.validator.parseAndValidate<ContextResolveResult>(
      "context-resolve",
      resolveResult.text,
    );

    if (!resolved || !resolved.has_context || !resolved.project_id) {
      return { ok: true, hasContext: false, context: "" };
    }

    // ── 3. Build context block for the resolved project ────────────────────
    const projectDir = this.projectState.projectDir(resolved.project_id);
    const flowId     = (resolved.relevant_flow_ids ?? [])[0] ?? "default";

    // ContextBuilder needs a MemoryEngine scoped to this project
    const memory = new MemoryEngine(projectDir);

    const contextResult = await this.contextBuilder.build({
      projectDir,
      flowId,
    });

    return {
      ok:         true,
      hasContext: true,
      context:    contextResult.context,
    };
  }
}
