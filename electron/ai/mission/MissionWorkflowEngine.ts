/**
 * MissionWorkflowEngine.ts
 *
 * State machine for the Beta-2 mission workflow.
 * Coordinates all evaluators and planning modules.
 * Caller (IPC handler) manages persistence via ProjectStateManager.
 *
 * STATE FLOW (Project path):
 *   NEW_MISSION → CLASSIFYING → AWAITING_CLASSIFICATION_CONFIRMATION
 *   → PROJECT_GOAL_CAPTURE → PROJECT_END_GOAL_CAPTURE
 *   → INITIAL_DESIRABILITY_EVALUATION → IDEATION_ROADMAP → ROADMAP_REVIEW
 *   → PROJECT_EXECUTION ↔ PROGRESS_VALIDATION ↔ PROGRESS_CORRECTION
 *   → IDEATION → IDEATION_READY → DVF_EVALUATION → DVF_REVIEW
 *   → AWAITING_DECISION → (IMPROVEMENT | REDESIGN | FINAL_ROADMAP)
 *   → EXECUTION → COMPLETED
 *
 * STATE FLOW (Subject path):
 *   NEW_MISSION → CLASSIFYING → AWAITING_CLASSIFICATION_CONFIRMATION
 *   → SUBJECT_SETUP → SUBJECT_OUTCOME_CONFIRMATION → SUBJECT_FLOW_CREATION
 *   → SUBJECT_ACTIVE
 *
 * Rules:
 *   - Invalid transitions return { ok: false, error: "..." }
 *   - State is NOT persisted here — caller persists via updateMeta()
 *   - DVF evaluations are appended, never overwritten (see appendDVF)
 */

import { MissionClassifier }      from "./MissionClassifier";
import { DesirabilityEvaluator }   from "../evaluation/DesirabilityEvaluator";
import { DVFEvaluator }            from "../evaluation/DVFEvaluator";
import { ProgressEvaluator }       from "../evaluation/ProgressEvaluator";
import { DecisionEngine }          from "../evaluation/DecisionEngine";
import { AiPlanningEngine }        from "../planning/AiPlanningEngine";
import { RoadmapVersioning }       from "../planning/RoadmapVersioning";
import { ProjectStateManager }     from "../project/ProjectStateManager";
import type {
  MissionWorkflowState,
  ProjectMeta,
  ProjectGoal,
  EndGoal,
  IdeationState,
} from "../project/types";
import type {
  MissionClassification,
  DesirabilityResult,
  DVFResult,
  ProgressEvaluation,
  DecisionResult,
} from "../types/ai-schemas";

// ─── Valid transitions ─────────────────────────────────────────────────────────

// ponytail: flat lookup — if we need graph traversal add it then.
const VALID_TRANSITIONS: Record<MissionWorkflowState, MissionWorkflowState[]> = {
  NEW_MISSION:                        ["CLASSIFYING"],
  CLASSIFYING:                        ["AWAITING_CLASSIFICATION_CONFIRMATION"],
  AWAITING_CLASSIFICATION_CONFIRMATION: ["PROJECT_GOAL_CAPTURE", "SUBJECT_SETUP", "CLASSIFYING"],
  PROJECT_GOAL_CAPTURE:               ["PROJECT_END_GOAL_CAPTURE"],
  PROJECT_END_GOAL_CAPTURE:           ["INITIAL_DESIRABILITY_EVALUATION"],
  INITIAL_DESIRABILITY_EVALUATION:    ["IDEATION_ROADMAP"],
  IDEATION_ROADMAP:                   ["ROADMAP_REVIEW"],
  ROADMAP_REVIEW:                     ["PROJECT_EXECUTION", "IDEATION_ROADMAP"],
  PROJECT_EXECUTION:                  ["PROGRESS_VALIDATION", "IDEATION"],
  PROGRESS_VALIDATION:                ["PROJECT_EXECUTION", "PROGRESS_CORRECTION", "IDEATION"],
  PROGRESS_CORRECTION:                ["PROGRESS_VALIDATION"],
  IDEATION:                           ["IDEATION_READY"],
  IDEATION_READY:                     ["DVF_EVALUATION"],
  DVF_EVALUATION:                     ["DVF_REVIEW"],
  DVF_REVIEW:                         ["AWAITING_DECISION"],
  AWAITING_DECISION:                  ["IMPROVEMENT", "REDESIGN", "FINAL_ROADMAP"],
  IMPROVEMENT:                        ["DVF_EVALUATION"],
  REDESIGN:                           ["PROJECT_GOAL_CAPTURE"],
  FINAL_ROADMAP:                      ["EXECUTION"],
  EXECUTION:                          ["PROGRESS_VALIDATION", "COMPLETED"],
  COMPLETED:                          [],
  SUBJECT_SETUP:                      ["SUBJECT_OUTCOME_CONFIRMATION"],
  SUBJECT_OUTCOME_CONFIRMATION:       ["SUBJECT_FLOW_CREATION", "SUBJECT_SETUP"],
  SUBJECT_FLOW_CREATION:              ["SUBJECT_ACTIVE"],
  SUBJECT_ACTIVE:                     ["NEW_MISSION"],
};

function canTransition(from: MissionWorkflowState, to: MissionWorkflowState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Result types ──────────────────────────────────────────────────────────────

export interface WorkflowResult<T = void> {
  ok:         boolean;
  nextState?: MissionWorkflowState;
  data?:      T;
  error?:     string;
}

// ─── MissionWorkflowEngine ────────────────────────────────────────────────────

export class MissionWorkflowEngine {
  constructor(
    private readonly classifier:     MissionClassifier,
    private readonly desirability:   DesirabilityEvaluator,
    private readonly dvf:            DVFEvaluator,
    private readonly progress:       ProgressEvaluator,
    private readonly decision:       DecisionEngine,
    private readonly planning:       AiPlanningEngine,
    private readonly roadmapVersioning: RoadmapVersioning,
    private readonly projectState:   ProjectStateManager,
  ) {}

  // ── Classification ─────────────────────────────────────────────────────────

  async classify(projectId: string, userMessage: string): Promise<WorkflowResult<MissionClassification>> {
    const result = await this.classifier.classify(userMessage);
    if (!result.ok || !result.classification) {
      return { ok: false, error: result.error };
    }

    await this.projectState.updateMeta(projectId, {
      workflow_state:  "AWAITING_CLASSIFICATION_CONFIRMATION",
      classification:  result.classification,
      classification_confirmed: false,
    });

    return {
      ok:        true,
      nextState: "AWAITING_CLASSIFICATION_CONFIRMATION",
      data:      result.classification,
    };
  }

  confirmationMessage(classification: MissionClassification): string {
    return this.classifier.confirmationMessage(classification);
  }

  async confirmClassification(
    projectId: string,
    confirmed: boolean,
    correctedMessage?: string,
  ): Promise<WorkflowResult<MissionClassification>> {
    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) return { ok: false, error: metaResult.error };

    if (!confirmed && correctedMessage) {
      // User corrected — reclassify from scratch
      return this.classify(projectId, correctedMessage);
    }

    const classification = metaResult.data.classification!;
    const nextState: MissionWorkflowState =
      classification.mission_type === "project"
        ? "PROJECT_GOAL_CAPTURE"
        : "SUBJECT_SETUP";

    await this.projectState.updateMeta(projectId, {
      workflow_state:           nextState,
      classification_confirmed: true,
    });

    return { ok: true, nextState, data: classification };
  }

  // ── Project goal capture ───────────────────────────────────────────────────

  async saveProjectGoal(projectId: string, goal: ProjectGoal): Promise<WorkflowResult> {
    return this.transition(projectId, "PROJECT_END_GOAL_CAPTURE", { project_goal: goal });
  }

  async saveEndGoal(projectId: string, endGoal: EndGoal): Promise<WorkflowResult> {
    return this.transition(projectId, "INITIAL_DESIRABILITY_EVALUATION", { end_goal: endGoal });
  }

  // ── Desirability evaluation ────────────────────────────────────────────────

  async evaluateDesirability(
    projectId: string,
    vars: Parameters<DesirabilityEvaluator["evaluate"]>[0],
  ): Promise<WorkflowResult<DesirabilityResult>> {
    const result = await this.desirability.evaluate(vars);
    if (!result.ok || !result.result) return { ok: false, error: result.error };

    await this.projectState.updateMeta(projectId, {
      workflow_state:       "IDEATION_ROADMAP",
      initial_desirability: result.result,
    });

    return { ok: true, nextState: "IDEATION_ROADMAP", data: result.result };
  }

  // ── Roadmap ────────────────────────────────────────────────────────────────

  async generateIdeationRoadmap(projectId: string, contextBlock?: string): Promise<WorkflowResult> {
    const planResult = await this.planning.generate({ projectId, contextBlock, persist: true });
    if (!planResult.ok) return { ok: false, error: planResult.error };

    await this.projectState.updateMeta(projectId, { workflow_state: "ROADMAP_REVIEW" });
    return { ok: true, nextState: "ROADMAP_REVIEW" };
  }

  async refineRoadmap(projectId: string, userRequest: string, contextBlock?: string): Promise<WorkflowResult> {
    const result = await this.roadmapVersioning.refineWithHistory({ projectId, userRequest, contextBlock });
    if (!result.ok) return { ok: false, error: result.error };

    await this.projectState.updateMeta(projectId, { workflow_state: "ROADMAP_REVIEW" });
    return { ok: true, nextState: "ROADMAP_REVIEW" };
  }

  async approveRoadmap(projectId: string): Promise<WorkflowResult> {
    return this.transition(projectId, "PROJECT_EXECUTION");
  }

  // ── Progress validation ────────────────────────────────────────────────────

  async validateProgress(
    projectId: string,
    vars: Parameters<ProgressEvaluator["evaluate"]>[0],
  ): Promise<WorkflowResult<ProgressEvaluation>> {
    const result = await this.progress.evaluate(vars);
    if (!result.ok || !result.result) return { ok: false, error: result.error };

    const nextState: MissionWorkflowState = result.result.ready_to_advance
      ? "PROJECT_EXECUTION"
      : "PROGRESS_CORRECTION";

    await this.projectState.updateMeta(projectId, { workflow_state: nextState });
    return { ok: true, nextState, data: result.result };
  }

  // ── Ideation ───────────────────────────────────────────────────────────────

  async startIdeation(projectId: string): Promise<WorkflowResult> {
    const ideationState: IdeationState = {
      status:     "IN_PROGRESS",
      started_at: new Date().toISOString(),
      notes:      [],
      concepts:   [],
    };
    return this.transition(projectId, "IDEATION", { ideation_state: ideationState });
  }

  async markIdeationReady(projectId: string): Promise<WorkflowResult> {
    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) return { ok: false, error: metaResult.error };

    const ideationState: IdeationState = {
      ...(metaResult.data.ideation_state ?? { notes: [], concepts: [] }),
      status: "READY_FOR_EVALUATION",
    };
    return this.transition(projectId, "IDEATION_READY", { ideation_state: ideationState });
  }

  // ── DVF evaluation ─────────────────────────────────────────────────────────

  async evaluateDVF(
    projectId: string,
    vars: Parameters<DVFEvaluator["evaluate"]>[0],
  ): Promise<WorkflowResult<DVFResult>> {
    const result = await this.dvf.evaluate(vars);
    if (!result.ok || !result.result) return { ok: false, error: result.error };

    // Append to dvf_evaluations — never overwrite
    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) return { ok: false, error: metaResult.error };

    const existing = metaResult.data.dvf_evaluations ?? [];
    await this.projectState.updateMeta(projectId, {
      workflow_state:  "DVF_REVIEW",
      dvf_evaluations: [...existing, result.result],
    });

    return { ok: true, nextState: "DVF_REVIEW", data: result.result };
  }

  // ── Decision ───────────────────────────────────────────────────────────────

  async recordDecision(
    projectId: string,
    vars: Parameters<DecisionEngine["classify"]>[0],
  ): Promise<WorkflowResult<DecisionResult>> {
    const result = await this.decision.classify(vars);
    if (!result.ok || !result.result) return { ok: false, error: result.error };

    const nextState: MissionWorkflowState =
      result.result.decision === "continue"  ? "FINAL_ROADMAP"
      : result.result.decision === "improve" ? "IMPROVEMENT"
      : "REDESIGN";

    await this.projectState.updateMeta(projectId, {
      workflow_state: nextState,
      decision:       result.result,
    });

    return { ok: true, nextState, data: result.result };
  }

  // ── Final roadmap ──────────────────────────────────────────────────────────

  async generateFinalRoadmap(projectId: string, contextBlock?: string): Promise<WorkflowResult> {
    // Guard the transition BEFORE spending an inference call on the plan
    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) return { ok: false, error: metaResult.error };

    const current = metaResult.data.workflow_state ?? "NEW_MISSION";
    if (!canTransition(current, "EXECUTION")) {
      return { ok: false, error: `Invalid transition: ${current} → EXECUTION` };
    }

    const planResult = await this.planning.generate({ projectId, contextBlock, persist: true });
    if (!planResult.ok) return { ok: false, error: planResult.error };

    await this.projectState.updateMeta(projectId, { workflow_state: "EXECUTION" });
    return { ok: true, nextState: "EXECUTION" };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async transition(
    projectId: string,
    nextState: MissionWorkflowState,
    extra?: Partial<ProjectMeta>,
  ): Promise<WorkflowResult> {
    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) return { ok: false, error: metaResult.error };

    const current = metaResult.data.workflow_state ?? "NEW_MISSION";
    if (!canTransition(current, nextState)) {
      return { ok: false, error: `Invalid transition: ${current} → ${nextState}` };
    }

    await this.projectState.updateMeta(projectId, { workflow_state: nextState, ...extra });
    return { ok: true, nextState };
  }
}
