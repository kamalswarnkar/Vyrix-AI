/**
 * AiEvaluationFramework.ts  (M19)
 *
 * Validates AI responses and user inputs against quality criteria
 * before the state machine advances.
 *
 * Evaluation types:
 *   - Interview step completion (did the user answer well enough?)
 *   - Roadmap quality (is the generated plan production-grade?)
 *   - General content evaluation (custom criteria)
 *
 * Each evaluation returns an EvaluationResult with:
 *   - is_valid: bool
 *   - score: 0-100
 *   - feedback: string
 *   - suggestions: string[]
 *   - ready_to_advance: bool
 */

import { PromptEngine }    from "../prompt/PromptEngine";
import { SchemaValidator } from "../validation/SchemaValidator";
import {
  evaluationSystemPrompt,
  evaluationPrompt,
  stepCompletionEvalPrompt,
  roadmapEvalPrompt,
} from "../prompt/templates/evaluation";
import type { EvaluationResult } from "../types/ai-schemas";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalResponse {
  ok:      boolean;
  result?: EvaluationResult;
  error?:  string;
}

export interface StepCompletionInput {
  stepNumber:   number;
  userResponse: string;
  stepGoal:     string;
}

export interface RoadmapEvalInput {
  projectId:    string;
  missionTitle: string;
  roadmapJson:  string;
  contextBlock?: string;
}

export interface GeneralEvalInput {
  subject:      string;
  content:      string;
  criteria:     string[];
  contextBlock?: string;
}

// ─── AiEvaluationFramework ───────────────────────────────────────────────────

export class AiEvaluationFramework {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly validator:    SchemaValidator,
  ) {}

  /**
   * Evaluate whether a user's interview step response is sufficient to advance.
   */
  async evaluateStepCompletion(input: StepCompletionInput): Promise<EvalResponse> {
    const result = await this.promptEngine.run({
      systemPrompt: evaluationSystemPrompt(),
      userMessage:  stepCompletionEvalPrompt({
        stepNumber:   input.stepNumber,
        userResponse: input.userResponse,
        stepGoal:     input.stepGoal,
      }),
      taskType: "evaluation-result",
    });

    return this.parseEvalResult(result);
  }

  /**
   * Evaluate the quality of a generated roadmap.
   */
  async evaluateRoadmap(input: RoadmapEvalInput): Promise<EvalResponse> {
    const result = await this.promptEngine.run({
      systemPrompt: evaluationSystemPrompt(),
      userMessage:  roadmapEvalPrompt({
        missionTitle: input.missionTitle,
        roadmapJson:  input.roadmapJson,
        contextBlock: input.contextBlock,
      }),
      taskType: "evaluation-result",
    });

    return this.parseEvalResult(result);
  }

  /**
   * General-purpose evaluation against custom criteria.
   */
  async evaluate(input: GeneralEvalInput): Promise<EvalResponse> {
    const result = await this.promptEngine.run({
      systemPrompt: evaluationSystemPrompt(),
      userMessage:  evaluationPrompt({
        subject:      input.subject,
        content:      input.content,
        criteria:     input.criteria,
        contextBlock: input.contextBlock,
      }),
      taskType: "evaluation-result",
    });

    return this.parseEvalResult(result);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private parseEvalResult(result: { ok: boolean; text?: string; error?: string }): EvalResponse {
    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "Empty evaluation response" };
    }

    const parsed = this.validator.parseAndValidate<EvaluationResult>(
      "evaluation-result",
      result.text,
    );

    if (!parsed) {
      return { ok: false, error: "Evaluation response failed schema validation" };
    }

    return { ok: true, result: parsed };
  }
}
