/**
 * MissionClassifier.ts
 *
 * Classifies a user's new mission as "subject" (predefined learning outcomes)
 * or "project" (problem to solve, no fixed outcome).
 *
 * Uses PromptEngine with the mission-classification taskType so it goes through
 * the same schema validation + optional GBNF grammar path as all other modules.
 *
 * Usage:
 *   const classifier = new MissionClassifier(promptEngine, validator);
 *   const result = await classifier.classify("I want to build a food delivery app");
 *   // { mission_type: "project", confidence: 90, ... }
 */

import { PromptEngine }    from "../prompt/PromptEngine";
import { SchemaValidator } from "../validation/SchemaValidator";
import {
  missionClassificationSystemPrompt,
  missionClassificationPrompt,
  classificationConfirmationMessage,
  type ConfirmationPromptVars,
} from "../prompt/templates/mission";
import type { MissionClassification } from "../types/ai-schemas";

export interface ClassifyResult {
  ok:             boolean;
  classification?: MissionClassification;
  error?:         string;
}

export interface ConfirmationMessageResult {
  message: string;
}

// ─── MissionClassifier ────────────────────────────────────────────────────────

export class MissionClassifier {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly validator:    SchemaValidator,
  ) {}

  /**
   * Classify the user's mission description.
   * Returns a MissionClassification or an error.
   */
  async classify(userMessage: string): Promise<ClassifyResult> {
    const result = await this.promptEngine.run({
      systemPrompt: missionClassificationSystemPrompt(),
      userMessage:  missionClassificationPrompt(userMessage),
      taskType:     "mission-classification",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "No response from model" };
    }

    const parsed = this.validator.parseAndValidate<MissionClassification>(
      "mission-classification",
      result.text,
    );

    if (!parsed) {
      return { ok: false, error: "Classification response failed schema validation" };
    }

    return { ok: true, classification: parsed };
  }

  /**
   * Build the confirmation message the AI shows the user after classification.
   * Pure function — no model call needed.
   */
  confirmationMessage(classification: MissionClassification): string {
    const vars: ConfirmationPromptVars = {
      missionType:       classification.mission_type,
      reasoning:         classification.reasoning,
      understoodProblem: classification.understood_problem,
      detectedGoals:     classification.detected_goals ?? [],
    };
    return classificationConfirmationMessage(vars);
  }
}
