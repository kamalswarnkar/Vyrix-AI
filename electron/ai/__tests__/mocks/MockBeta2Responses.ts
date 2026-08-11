/**
 * MockBeta2Responses.ts
 *
 * Canned JSON responses for all Beta-2 task types.
 * Use with MockPromptEngine.onTaskType() to test Beta-2 modules
 * without a live model.
 *
 * Usage:
 *   const engine = new MockPromptEngine();
 *   applyBeta2Defaults(engine);
 *   // or override individual task types:
 *   engine.onTaskType("mission-classification", MOCK_RESPONSES["mission-classification"]);
 */

import type { MockPromptEngine } from "./MockPromptEngine";

// ─── Canned responses ──────────────────────────────────────────────────────────

export const MOCK_BETA2_RESPONSES: Record<string, string> = {
  "mission-classification": JSON.stringify({
    mission_type:       "project",
    confidence:         85,
    reasoning:          "User described a problem to solve with a specific deliverable and constraints.",
    understood_problem: "Build a food delivery application targeting university students.",
    detected_goals:     ["Reduce food waste", "Improve delivery speed"],
    detected_outcomes:  ["Working prototype"],
    constraints:        ["Limited budget", "3-month timeline"],
    resources:          ["Two developers", "University campus network"],
  }),

  "desirability-evaluation": JSON.stringify({
    stage:           "initial_desirability",
    score:           72,
    problem_clarity: { summary: "Problem is clearly stated with identifiable users.", score: 80 },
    demand_strength: { summary: "Demand is plausible but requires validation.", score: 65 },
    evidence:        [
      { statement: "University students frequently order food", type: "assumption" },
      { statement: "Existing apps don't serve this campus", type: "requires_validation" },
    ],
    assumptions:     ["Students will pay delivery fees"],
    risks:           ["Low margin food delivery market"],
    recommendations: ["Conduct 10 user interviews", "Survey campus food ordering habits"],
    ready_for_ideation: true,
  }),

  "dvf-evaluation": JSON.stringify({
    stage:       "dvf_evaluation",
    version:     1,
    desirability: {
      score:    75,
      summary:  "Clear user need identified.",
      evidence: [{ statement: "Students want fast food options", type: "assumption" }],
      risks:    ["Demand may be seasonal"],
    },
    viability: {
      score:    60,
      summary:  "Revenue model needs refinement.",
      evidence: [{ statement: "Commission-based models work in similar markets", type: "assumption" }],
      risks:    ["Restaurant partnerships uncertain"],
    },
    feasibility: {
      score:    70,
      summary:  "Tech stack is feasible within constraints.",
      evidence: [{ statement: "React Native covers both platforms", type: "evidence" }],
      risks:    ["Real-time tracking complexity"],
    },
    overall_score:      68,
    recommendation:     "Improve viability before proceeding. Validate restaurant partnerships.",
    strengths:          ["Clear user need", "Achievable tech stack"],
    gaps:               ["Revenue model unclear", "Partnership strategy missing"],
    ready_for_decision: true,
  }),

  "progress-evaluation": JSON.stringify({
    step:             1,
    step_title:       "Problem Clarification",
    is_complete:      true,
    score:            75,
    feedback:         "Good problem statement with clear user group identified.",
    suggestions:      ["Add more specific pain points", "Quantify the problem scope"],
    ready_to_advance: true,
  }),

  "decision": JSON.stringify({
    decision:   "improve",
    reasoning:  "Overall score of 68 indicates a solid foundation but viability needs work.",
    confidence: 78,
    next_steps: [
      "Research restaurant partnership models",
      "Define commission structure",
      "Prototype delivery tracking feature",
    ],
  }),
};

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Register all Beta-2 canned responses on an existing MockPromptEngine. */
export function applyBeta2Defaults(engine: MockPromptEngine): void {
  for (const [taskType, response] of Object.entries(MOCK_BETA2_RESPONSES)) {
    engine.onTaskType(taskType, response);
  }
}
