/**
 * DVFEvaluator.ts
 *
 * Full Desirability + Viability + Feasibility evaluation after ideation.
 * All evaluations are versioned and appended — never overwritten.
 * Versioning is managed by the caller (MissionWorkflowEngine).
 */

import { PromptEngine }    from "../prompt/PromptEngine";
import { SchemaValidator } from "../validation/SchemaValidator";
import {
  dvfSystemPrompt,
  dvfEvalPrompt,
  type DVFEvalVars,
} from "../prompt/templates/dvf";
import type { DVFResult } from "../types/ai-schemas";

export interface DVFEvalResult {
  ok:     boolean;
  result?: DVFResult;
  error?:  string;
}

export class DVFEvaluator {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly validator:    SchemaValidator,
  ) {}

  async evaluate(vars: DVFEvalVars): Promise<DVFEvalResult> {
    const result = await this.promptEngine.run({
      systemPrompt: dvfSystemPrompt(),
      userMessage:  dvfEvalPrompt(vars),
      taskType:     "dvf-evaluation",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "No response from model" };
    }

    const parsed = this.validator.parseAndValidate<DVFResult>(
      "dvf-evaluation",
      result.text,
    );

    if (!parsed) {
      return { ok: false, error: "DVF response failed schema validation" };
    }

    return { ok: true, result: parsed };
  }
}
