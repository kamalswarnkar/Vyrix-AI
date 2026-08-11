/**
 * fixtures/schemas.ts
 *
 * Valid JSON fixture objects for all AI schema types.
 * Used in unit tests to verify parsing, validation, and state transitions.
 */

import type {
  InterviewStepResponse,
  InterviewPlan,
  PlanStep,
  MemoryDelta,
  KeywordExtraction,
  EvaluationResult,
  ContextResolveResult,
  GenerativeUIPayload,
} from "../../types/ai-schemas";

// ─── InterviewStepResponse ────────────────────────────────────────────────────

export const validInterviewStep: InterviewStepResponse = {
  step_number:            1,
  ai_message:             "What are you trying to achieve with this mission, and why does it matter to you?",
  skip_next_step:         false,
  requires_clarification: false,
  extracted: {
    project_description: "Build a multi-tenant SaaS dashboard",
    goals:               "Increase team productivity by 30%",
    understanding_level: "advanced",
  },
};

export const validInterviewStepSkip: InterviewStepResponse = {
  step_number:            1,
  ai_message:             "You've given a comprehensive overview. Let's move to the output type.",
  skip_next_step:         true,
  requires_clarification: false,
  extracted: {
    goals: "Ship MVP in Q3",
    understanding_level: "advanced",
  },
};

export function interviewStepJson(overrides: Partial<InterviewStepResponse> = {}): string {
  return JSON.stringify({ ...validInterviewStep, ...overrides });
}

// ─── InterviewPlan ────────────────────────────────────────────────────────────

const sampleStep: PlanStep = {
  step:               1,
  title:              "Define Requirements",
  description:        "Gather and document all functional and non-functional requirements.",
  methodology:        "Stakeholder interviews + MoSCoW prioritisation",
  estimated_duration: "3-5 days",
  deliverable:        "Requirements document",
};

export const validInterviewPlan: InterviewPlan = {
  steps:       Array.from({ length: 6 }, (_, i) => ({ ...sampleStep, step: i + 1, title: `Step ${i + 1}` })),
  total_steps: 6,
  summary:     "A 6-step plan to build and launch the product.",
};

export function interviewPlanJson(overrides: Partial<InterviewPlan> = {}): string {
  return JSON.stringify({ ...validInterviewPlan, ...overrides });
}

// ─── MemoryDelta ──────────────────────────────────────────────────────────────

export const validMemoryDelta: MemoryDelta = {
  key:        "Tech Stack",
  value:      "React, Node.js, PostgreSQL",
  category:   "technical",
  confidence: 0.9,
};

export const noOpMemoryDelta: MemoryDelta = {
  key:      "no-op",
  value:    "",
  category: "general",
};

export function memoryDeltaJson(overrides: Partial<MemoryDelta> = {}): string {
  return JSON.stringify({ ...validMemoryDelta, ...overrides });
}

// ─── KeywordExtraction ────────────────────────────────────────────────────────

export const validKeywordExtraction: KeywordExtraction = {
  keywords:                  ["authentication", "role-based access", "dashboard"],
  decisions:                 [{ key: "Auth Library", value: "Auth0", category: "technical" }],
  has_significant_decision:  true,
};

export function keywordExtractionJson(overrides: Partial<KeywordExtraction> = {}): string {
  return JSON.stringify({ ...validKeywordExtraction, ...overrides });
}

// ─── EvaluationResult ────────────────────────────────────────────────────────

export const validEvaluationResult: EvaluationResult = {
  is_valid:         true,
  feedback:         "The response clearly addresses the goal with specific details.",
  suggestions:      ["Consider adding timeline constraints for more specificity."],
  ready_to_advance: true,
  score:            82,
  strengths:        ["Specific", "Actionable", "Relevant"],
};

export const lowScoreEvaluation: EvaluationResult = {
  is_valid:         false,
  feedback:         "The response is too vague. Please provide more specific information.",
  suggestions:      ["Be more specific about goals", "Include measurable outcomes"],
  ready_to_advance: false,
  score:            35,
};

export function evaluationResultJson(overrides: Partial<EvaluationResult> = {}): string {
  return JSON.stringify({ ...validEvaluationResult, ...overrides });
}

// ─── ContextResolveResult ─────────────────────────────────────────────────────

export const validContextResolve: ContextResolveResult = {
  has_context:          true,
  project_id:           "proj-abc-123",
  project_title:        "SaaS Dashboard",
  relevant_flow_ids:    ["flow-001"],
  context_summary:      "A multi-tenant SaaS dashboard project",
};

export const noContextResolve: ContextResolveResult = {
  has_context:       false,
  project_id:        "",
  relevant_flow_ids: [],
};

// ─── GenerativeUIPayload ──────────────────────────────────────────────────────

export const validGenerativeUI: GenerativeUIPayload = {
  component_type: "roadmap_card",
  title:          "Project Roadmap",
  data:           { steps: [{ title: "Phase 1", description: "Foundation" }] },
  action_label:   "View Full Roadmap",
  action_type:    "open_mission",
};
