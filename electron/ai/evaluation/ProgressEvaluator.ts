/**
 * ProgressEvaluator.ts
 *
 * Evaluates user work against a project roadmap step.
 * Accepts extracted text (from FileExtractor) or plain user message.
 * Used during PROJECT_EXECUTION and IDEATION states.
 */

import { PromptEngine }    from "../prompt/PromptEngine";
import { SchemaValidator } from "../validation/SchemaValidator";
import {
  progressSystemPrompt,
  progressEvalPrompt,
  type ProgressEvalVars,
} from "../prompt/templates/progress";
import type { ProgressEvaluation } from "../types/ai-schemas";

export interface ProgressEvalResult {
  ok:     boolean;
  result?: ProgressEvaluation;
  error?:  string;
}

export class ProgressEvaluator {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly validator:    SchemaValidator,
  ) {}

  async evaluate(vars: ProgressEvalVars): Promise<ProgressEvalResult> {
    const result = await this.promptEngine.run({
      systemPrompt: progressSystemPrompt(),
      userMessage:  progressEvalPrompt(vars),
      taskType:     "progress-evaluation",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "No response from model" };
    }

    const parsed = this.validator.parseAndValidate<ProgressEvaluation>(
      "progress-evaluation",
      result.text,
    );

    if (!parsed) {
      return { ok: false, error: "Progress evaluation response failed schema validation" };
    }

    return { ok: true, result: parsed };
  }
}
