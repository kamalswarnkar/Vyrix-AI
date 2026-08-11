/**
 * DVFEvaluator.test.ts
 * Unit tests for DVFEvaluator — deterministic, mock-only.
 *
 * Run: npx jest electron/ai/evaluation/DVFEvaluator.test.ts
 */

import { DVFEvaluator }      from "./DVFEvaluator";
import { MockPromptEngine }  from "../__tests__/mocks/MockPromptEngine";
import { SchemaValidator }   from "../validation/SchemaValidator";

const VALID_DVF = JSON.stringify({
  stage:       "dvf_evaluation",
  version:     1,
  desirability: { score: 75, summary: "Good demand.", evidence: [], risks: [] },
  viability:    { score: 60, summary: "Needs work.", evidence: [], risks: [] },
  feasibility:  { score: 70, summary: "Achievable.",  evidence: [], risks: [] },
  overall_score:      68,
  recommendation:     "Improve viability first.",
  strengths:          ["Clear user need"],
  gaps:               ["Revenue unclear"],
  ready_for_decision: true,
});

let engine:  MockPromptEngine;
let evaluator: DVFEvaluator;

beforeEach(() => {
  engine    = new MockPromptEngine();
  evaluator = new DVFEvaluator(engine as any, new SchemaValidator());
});

describe("evaluate()", () => {
  it("returns a valid DVF result", async () => {
    engine.onTaskType("dvf-evaluation", VALID_DVF);
    const result = await evaluator.evaluate({
      projectTitle:       "FoodApp",
      problemStatement:   "Students can't get food fast",
      endGoalType:        "prototype",
      endGoalDescription: "Working MVP",
      ideationConcepts:   ["Campus-only delivery", "Peer-to-peer model"],
      dvfVersion:         1,
    });
    expect(result.ok).toBe(true);
    expect(result.result?.overall_score).toBe(68);
    expect(result.result?.stage).toBe("dvf_evaluation");
    expect(result.result?.ready_for_decision).toBe(true);
  });

  it("returns ok:false on invalid JSON", async () => {
    engine.onTaskType("dvf-evaluation", "bad json");
    const result = await evaluator.evaluate({
      projectTitle: "X", problemStatement: "Y", endGoalType: "prototype",
      endGoalDescription: "Z", ideationConcepts: [], dvfVersion: 1,
    });
    expect(result.ok).toBe(false);
  });

  it("sends dvf-evaluation taskType to promptEngine", async () => {
    engine.onTaskType("dvf-evaluation", VALID_DVF);
    await evaluator.evaluate({
      projectTitle: "X", problemStatement: "Y", endGoalType: "prototype",
      endGoalDescription: "Z", ideationConcepts: [], dvfVersion: 1,
    });
    expect(engine.calls[0]?.taskType).toBe("dvf-evaluation");
  });
});
