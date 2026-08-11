/**
 * ai-schemas.d.ts
 * TypeScript interfaces derived from all AI schema definitions.
 * These types represent the structured JSON output produced by the LLM,
 * validated against the corresponding JSON Schema files in ../schemas/.
 *
 * IMPORTANT: Keep these types in sync with the .schema.json files.
 * The source of truth is the JSON Schema — update that first, then update here.
 */

// ─── Interview Step ───────────────────────────────────────────────────────────

export type InterviewStepNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type UnderstandingLevel  = "beginner" | "intermediate" | "advanced";
export type OutputType          = "prototype" | "3d_model" | "ideation" | "software" | "mixed";

export interface InterviewStepExtracted {
  project_description?: string;
  goals?:               string;
  understanding_level?: UnderstandingLevel;
  output_type?:         OutputType;
  domain_keywords?:     string[];
}

export interface InterviewStepResponse {
  step_number:             InterviewStepNumber;
  ai_message:              string;
  skip_next_step:          boolean;
  requires_clarification?: boolean;
  extracted:               InterviewStepExtracted;
}

// ─── Interview Plan ───────────────────────────────────────────────────────────

export interface PlanStep {
  step:                number;
  title:               string;
  description:         string;
  methodology:         string;
  estimated_duration?: string;
  deliverable?:        string;
}

export interface InterviewPlan {
  steps:       PlanStep[];
  total_steps: number;
  summary:     string;
  approach?:   string;
}

// ─── Memory Delta ─────────────────────────────────────────────────────────────

export type MemoryCategory =
  | "technical"
  | "design"
  | "user"
  | "timeline"
  | "decision"
  | "general";

export interface MemoryDelta {
  key:         string;
  value:       string;
  category:    MemoryCategory;
  confidence?: number;
}

/** What is stored in global-memory.log — includes the timestamp appended by MemoryEngine */
export interface MemoryDeltaRecord extends MemoryDelta {
  timestamp: string; // ISO 8601
}

// ─── Keyword Extraction ───────────────────────────────────────────────────────

export interface ExtractedDecision {
  key:       string;
  value:     string;
  category?: MemoryCategory;
}

export interface KeywordExtraction {
  keywords:                  string[];
  decisions:                 ExtractedDecision[];
  has_significant_decision:  boolean;
}

// ─── Evaluation Result ────────────────────────────────────────────────────────

export interface EvaluationResult {
  is_valid:         boolean;
  feedback:         string;
  suggestions:      string[];
  ready_to_advance: boolean;
  score:            number;
  strengths?:       string[];
}

// ─── Context Resolve ──────────────────────────────────────────────────────────

export interface ContextResolveResult {
  has_context:        boolean;
  project_id:         string;
  project_title?:     string;
  relevant_flow_ids?: string[];
  context_summary?:   string;
}

// ─── Generative UI ────────────────────────────────────────────────────────────

export type GenerativeUIComponentType =
  | "color_palette"
  | "checklist"
  | "roadmap_card"
  | "insight_card"
  | "keyword_cloud"
  | "comparison_table";

export type GenerativeUIActionType =
  | "save_to_memory"
  | "add_to_flow"
  | "open_mission"
  | "dismiss";

export interface GenerativeUIPayload {
  component_type: GenerativeUIComponentType;
  title:          string;
  data:           Record<string, unknown>;
  action_label?:  string;
  action_type?:   GenerativeUIActionType;
}

// ─── Mission Classification (Beta-2) ─────────────────────────────────────────

export type MissionType = "subject" | "project";

export interface MissionClassification {
  mission_type:       MissionType;
  confidence:         number;
  reasoning:          string;
  understood_problem: string;
  detected_goals?:    string[];
  detected_outcomes?: string[];
  constraints?:       string[];
  resources?:         string[];
}

// ─── Desirability Evaluation (Beta-2) ────────────────────────────────────────

export type EvidenceType = "evidence" | "assumption" | "unknown" | "requires_validation";

export interface DesirabilityFinding {
  statement: string;
  type:      EvidenceType;
}

export interface DesirabilityResult {
  stage:             "initial_desirability";
  score:             number;
  problem_clarity:   { summary: string; score: number };
  demand_strength:   { summary: string; score: number };
  evidence:          DesirabilityFinding[];
  assumptions:       string[];
  risks:             string[];
  recommendations:   string[];
  ready_for_ideation: boolean;
}

// ─── DVF Evaluation (Beta-2) ──────────────────────────────────────────────────

export interface DVFDimension {
  score:    number;
  summary:  string;
  evidence: DesirabilityFinding[];
  risks:    string[];
}

export interface DVFResult {
  stage:           "dvf_evaluation";
  version:         number;
  desirability:    DVFDimension;
  viability:       DVFDimension;
  feasibility:     DVFDimension;
  overall_score:   number;
  recommendation:  string;
  strengths:       string[];
  gaps:            string[];
  ready_for_decision: boolean;
}

// ─── Progress Evaluation (Beta-2) ─────────────────────────────────────────────

export interface ProgressEvaluation {
  step:             number;
  step_title:       string;
  is_complete:      boolean;
  score:            number;
  feedback:         string;
  suggestions:      string[];
  ready_to_advance: boolean;
  understanding_score?: number; // optional contextual understanding rating
}

// ─── Decision (Beta-2) ────────────────────────────────────────────────────────

export type DecisionType = "continue" | "improve" | "redesign";

export interface DecisionResult {
  decision:    DecisionType;
  reasoning:   string;
  confidence:  number;
  next_steps:  string[];
}

// ─── Task Type Registry ───────────────────────────────────────────────────────
// Maps task type names to their expected output schema type.

// ponytail: hyphen names match the actual .gbnf and .schema.json filenames exactly.
// workspace_chat / project_chat are plain-text tasks — no grammar/schema file needed.
export type TaskType =
  | "interview-step"
  | "interview-plan"
  | "memory-delta"
  | "keyword-extraction"
  | "evaluation-result"
  | "context-resolve"
  | "generative-ui"
  | "workspace-chat"
  | "project-chat"
  // Beta-2 task types
  | "mission-classification"
  | "desirability-evaluation"
  | "dvf-evaluation"
  | "progress-evaluation"
  | "decision";

export type TaskOutputMap = {
  "interview-step":         InterviewStepResponse;
  "interview-plan":         InterviewPlan;
  "memory-delta":           MemoryDelta;
  "keyword-extraction":     KeywordExtraction;
  "evaluation-result":      EvaluationResult;
  "context-resolve":        ContextResolveResult;
  "generative-ui":          GenerativeUIPayload;
  "workspace-chat":         string; // plain text — no grammar/schema file
  "project-chat":           string; // plain text — no grammar/schema file
  // Beta-2
  "mission-classification": MissionClassification;
  "desirability-evaluation": DesirabilityResult;
  "dvf-evaluation":          DVFResult;
  "progress-evaluation":     ProgressEvaluation;
  "decision":                DecisionResult;
};
