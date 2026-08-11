/**
 * AiPlanningEngine.ts  (M18)
 *
 * Generates and refines structured mission roadmaps (InterviewPlan).
 * Called after the 6-step interview completes to build the initial
 * roadmap, and by the AI chat for refinement requests.
 *
 * The generated plan is:
 *   - Validated against the InterviewPlan schema
 *   - Persisted to ProjectStateManager (project.json roadmap field)
 *   - Returned to the caller for display in the UI
 *
 * Usage:
 *   const engine = new AiPlanningEngine(promptEngine, validator, projectState);
 *   const plan   = await engine.generate(projectId, contextBlock);
 */

import { PromptEngine }        from "../prompt/PromptEngine";
import { SchemaValidator }     from "../validation/SchemaValidator";
import { ProjectStateManager } from "../project/ProjectStateManager";
import {
  planningSystemPrompt,
  planGenerationPrompt,
  roadmapRefinementPrompt,
} from "../prompt/templates/planning";
import type { InterviewPlan } from "../types/ai-schemas";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratePlanOptions {
  projectId:        string;
  contextBlock?:    string;
  stepCount?:       number;
  userConstraints?: string;
  /** If true, persist the plan to project.json */
  persist?:         boolean;
}

export interface RefinePlanOptions {
  projectId:    string;
  userRequest:  string;
  contextBlock?: string;
}

export interface PlanResult {
  ok:     boolean;
  plan?:  InterviewPlan;
  error?: string;
}

// ─── AiPlanningEngine ────────────────────────────────────────────────────────

export class AiPlanningEngine {
  constructor(
    private readonly promptEngine:   PromptEngine,
    private readonly validator:      SchemaValidator,
    private readonly projectState:   ProjectStateManager,
  ) {}

  /**
   * Generate an initial roadmap for the given project.
   */
  async generate(opts: GeneratePlanOptions): Promise<PlanResult> {
    const { projectId, contextBlock = "", stepCount = 7, userConstraints, persist = true } = opts;

    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) {
      return { ok: false, error: `Project not found: ${projectId}` };
    }

    const result = await this.promptEngine.run({
      systemPrompt: planningSystemPrompt(),
      userMessage:  planGenerationPrompt({
        missionTitle:    metaResult.data!.title,
        contextBlock,
        stepCount,
        userConstraints,
      }),
      taskType: "interview-plan",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "Planning engine returned empty response" };
    }

    const plan = this.validator.parseAndValidate<InterviewPlan>("interview-plan", result.text);
    if (!plan) {
      return { ok: false, error: "Generated plan failed schema validation" };
    }

    // Persist to project.json if requested
    if (persist) {
      await this.projectState.completeInterview(
        projectId,
        plan.steps.map(({ step, title }) => ({ step, title, completed: false })),
      );
    }

    return { ok: true, plan };
  }

  /**
   * Refine an existing roadmap based on a user's change request.
   */
  async refine(opts: RefinePlanOptions): Promise<PlanResult> {
    const { projectId, userRequest, contextBlock = "" } = opts;

    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) {
      return { ok: false, error: `Project not found: ${projectId}` };
    }

    const currentPlan = metaResult.data!.roadmap ?? [];
    const currentPlanJson = JSON.stringify({ steps: currentPlan, total_steps: currentPlan.length }, null, 2);

    const result = await this.promptEngine.run({
      systemPrompt: planningSystemPrompt(),
      userMessage:  roadmapRefinementPrompt({
        missionTitle: metaResult.data!.title,
        currentPlan:  currentPlanJson,
        userRequest,
      }),
      taskType: "interview-plan",
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error ?? "Refinement engine returned empty response" };
    }

    const plan = this.validator.parseAndValidate<InterviewPlan>("interview-plan", result.text);
    if (!plan) {
      return { ok: false, error: "Refined plan failed schema validation" };
    }

    // Persist refined plan
    await this.projectState.completeInterview(
        projectId,
        plan.steps.map(({ step, title }) => ({ step, title, completed: false })),
      );

    return { ok: true, plan };
  }
}
