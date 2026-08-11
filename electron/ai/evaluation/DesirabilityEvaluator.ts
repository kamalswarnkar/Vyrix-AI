/**
 * DesirabilityEvaluator.ts
 *
 * Evaluates initial desirability/demand at mission start.
 * NOT full DVF — only the demand dimension.
 * See DVFEvaluator for full evaluation after ideation.
 */

import { PromptEngine }    from "../prompt/PromptEngine";
import { SchemaValidator } from "../validation/SchemaValidator";
import {
  desirabilitySystemPrompt,
  desirabilityEvalPrompt,
  type DesirabilityEvalVars,
} from "../prompt/templates/desirability";
import type { DesirabilityResult } from "../types/ai-schemas";

export interface DesirabilityEvalResult {
  ok:     boolean;
  result?: DesirabilityResult;
  error?:  string;
}

export class DesirabilityEvaluator {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly validator:    SchemaValidator,
  ) {}

  async evaluate(vars: DesirabilityEvalVars): Promise<DesirabilityEvalResult> {
    const result = await this.promptEngine.run({
      systemPrompt: desirabilitySystemPrompt(),
      userMessage:  desirabilityEvalPrompt(vars),
      taskType:     "desirability-evaluation",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "No response from model" };
    }

    const parsed = this.validator.parseAndValidate<DesirabilityResult>(
      "desirability-evaluation",
      result.text,
    );

    if (!parsed) {
      return { ok: false, error: "Desirability response failed schema validation" };
    }

    return { ok: true, result: parsed };
  }
}
