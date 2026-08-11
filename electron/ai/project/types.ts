/**
 * types.ts — Project State Manager type definitions
 */

import type { PlanStep, MissionClassification, DesirabilityResult, DVFResult, DecisionResult } from "../types/ai-schemas.d";

// ─── On-disk structures ───────────────────────────────────────────────────────

export interface ProjectMeta {
  id:                   string;
  title:                string;
  description:          string;
  color:                string;
  cover_index:          number;
  folder_id:            string | null;
  parent_id:            string | null;
  starred:              0 | 1;
  deleted_at:           string | null;
  created_at:           string; // ISO 8601
  updated_at:           string; // ISO 8601
  interview_completed:  boolean;
  roadmap:              RoadmapEntry[];
  // ── Beta-2 fields (all optional — existing projects don't have them) ──────
  workflow_state?:              MissionWorkflowState;
  classification?:              MissionClassification;
  classification_confirmed?:    boolean;
  project_goal?:                ProjectGoal;
  end_goal?:                    EndGoal;
  initial_desirability?:        DesirabilityResult;
  roadmap_versions?:            RoadmapVersion[];
  current_roadmap_version?:     number;
  ideation_state?:              IdeationState;
  dvf_evaluations?:             DVFResult[];     // versioned, never overwritten
  decision?:                    DecisionResult;
  final_roadmap?:               RoadmapEntry[];
  improvement_history?:         string[];        // user feedback entries
}

export interface RoadmapEntry {
  step:        number;
  title:       string;
  completed:   boolean;
  completed_at?: string; // ISO 8601
}

// ─── Beta-2 types ─────────────────────────────────────────────────────────────

export type MissionWorkflowState =
  | "NEW_MISSION"
  | "CLASSIFYING"
  | "AWAITING_CLASSIFICATION_CONFIRMATION"
  | "SUBJECT_SETUP"
  | "SUBJECT_OUTCOME_CONFIRMATION"
  | "SUBJECT_FLOW_CREATION"
  | "SUBJECT_ACTIVE"
  | "PROJECT_GOAL_CAPTURE"
  | "PROJECT_END_GOAL_CAPTURE"
  | "INITIAL_DESIRABILITY_EVALUATION"
  | "IDEATION_ROADMAP"
  | "ROADMAP_REVIEW"
  | "PROJECT_EXECUTION"
  | "PROGRESS_VALIDATION"
  | "PROGRESS_CORRECTION"
  | "IDEATION"
  | "IDEATION_READY"
  | "DVF_EVALUATION"
  | "DVF_REVIEW"
  | "AWAITING_DECISION"
  | "IMPROVEMENT"
  | "REDESIGN"
  | "FINAL_ROADMAP"
  | "EXECUTION"
  | "COMPLETED";

export type EndGoalType =
  | "prototype"
  | "design"
  | "research_report"
  | "proof_of_concept"
  | "full_product"
  | "physical_product"
  | "presentation"
  | "other";

export interface EndGoal {
  type:         EndGoalType;
  description:  string;
  deadline?:    string | null; // ISO 8601 or null
  budget_inr?:  number | null;
  constraints?: string[];
}

export interface ProjectGoal {
  problem_statement: string;
  project_goal:      string;
  target_outcome:    string;
  constraints:       string[];
  available_resources: string[];
}

export interface RoadmapVersion {
  version:       number;
  timestamp:     string; // ISO 8601
  roadmap:       RoadmapEntry[];
  user_feedback?: string;
  previous_version?: number;
}

export interface IdeationState {
  status:      "NOT_STARTED" | "IN_PROGRESS" | "READY_FOR_EVALUATION" | "EVALUATED";
  started_at?: string;
  notes:       string[];
  concepts:    string[];
}

export interface ProjectSettings {
  preferred_flow_id?: string;
  ai_personality?:    "formal" | "casual" | "technical";
  language?:          string;
}

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface CreateProjectOptions {
  title?:      string;
  description?: string;
  color?:      string;
  folder_id?:  string | null;
  parent_id?:  string | null;
}

export interface UpdateProjectOptions {
  title?:               string;
  description?:         string;
  color?:               string;
  cover_index?:         number;
  interview_completed?: boolean;
  roadmap?:             RoadmapEntry[];
  // Beta-2
  workflow_state?:              MissionWorkflowState;
  classification?:              MissionClassification;
  classification_confirmed?:    boolean;
  project_goal?:                ProjectGoal;
  end_goal?:                    EndGoal;
  initial_desirability?:        DesirabilityResult;
  roadmap_versions?:            RoadmapVersion[];
  current_roadmap_version?:     number;
  ideation_state?:              IdeationState;
  dvf_evaluations?:             DVFResult[];
  decision?:                    DecisionResult;
  final_roadmap?:               RoadmapEntry[];
  improvement_history?:         string[];
}

export interface ProjectStateManagerResult<T> {
  ok:     true;
  data:   T;
}

export interface ProjectStateManagerError {
  ok:    false;
  error: string;
}

export type ProjectResult<T> = ProjectStateManagerResult<T> | ProjectStateManagerError;
