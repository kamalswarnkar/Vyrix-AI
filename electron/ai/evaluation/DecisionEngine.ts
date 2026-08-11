/**
 * DecisionEngine.ts
 *
 * Classifies the path after DVF evaluation: CONTINUE / IMPROVE / REDESIGN.
 * The user's own feedback is weighted heavily; the AI's role is to help
 * articulate and structure the decision, not override user intent.
 */

import { PromptEngine }    from "../prompt/PromptEngine";
import { SchemaValidator } from "../validation/SchemaValidator";
import {
  decisionSystemPrompt,
  decisionPrompt,
  type DecisionPromptVars,
} from "../prompt/templates/decision";
import type { DecisionResult } from "../types/ai-schemas";

export interface DecisionEngineResult {
  ok:     boolean;
  result?: DecisionResult;
  error?:  string;
}

export class DecisionEngine {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly validator:    SchemaValidator,
  ) {}

  async classify(vars: DecisionPromptVars): Promise<DecisionEngineResult> {
    const result = await this.promptEngine.run({
      systemPrompt: decisionSystemPrompt(),
      userMessage:  decisionPrompt(vars),
      taskType:     "decision",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "No response from model" };
    }

    const parsed = this.validator.parseAndValidate<DecisionResult>(
      "decision",
      result.text,
    );

    if (!parsed) {
      return { ok: false, error: "Decision response failed schema validation" };
    }

    return { ok: true, result: parsed };
  }
}
