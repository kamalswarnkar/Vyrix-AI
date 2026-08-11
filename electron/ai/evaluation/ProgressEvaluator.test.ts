/**
 * ProgressEvaluator.test.ts
 * Unit tests for ProgressEvaluator — deterministic, mock-only.
 *
 * Run: npx jest electron/ai/evaluation/ProgressEvaluator.test.ts
 */

import { ProgressEvaluator } from "./ProgressEvaluator";
import { MockPromptEngine }  from "../__tests__/mocks/MockPromptEngine";
import { SchemaValidator }   from "../validation/SchemaValidator";

const PASS_RESPONSE = JSON.stringify({
  step:             1,
  step_title:       "Problem Clarification",
  is_complete:      true,
  score:            75,
  feedback:         "Good problem statement.",
  suggestions:      [],
  ready_to_advance: true,
});

const FAIL_RESPONSE = JSON.stringify({
  step:             2,
  step_title:       "User Identification",
  is_complete:      false,
  score:            30,
  feedback:         "User group is too vague.",
  suggestions:      ["Be specific about who the users are"],
  ready_to_advance: false,
});

let engine:    MockPromptEngine;
let evaluator: ProgressEvaluator;

beforeEach(() => {
  engine    = new MockPromptEngine();
  evaluator = new ProgressEvaluator(engine as any, new SchemaValidator());
});

describe("evaluate()", () => {
  it("returns ready_to_advance:true for complete step", async () => {
    engine.onTaskType("progress-evaluation", PASS_RESPONSE);
    const result = await evaluator.evaluate({
      stepNumber: 1, stepTitle: "Problem Clarification",
      stepGoal: "Clarify the problem", userWork: "We are solving X for Y users.",
    });
    expect(result.ok).toBe(true);
    expect(result.result?.ready_to_advance).toBe(true);
    expect(result.result?.score).toBe(75);
  });

  it("returns ready_to_advance:false for incomplete step", async () => {
    engine.onTaskType("progress-evaluation", FAIL_RESPONSE);
    const result = await evaluator.evaluate({
      stepNumber: 2, stepTitle: "User Identification",
      stepGoal: "Identify users", userWork: "People.",
    });
    expect(result.ok).toBe(true);
    expect(result.result?.ready_to_advance).toBe(false);
    expect(result.result?.score).toBe(30);
    expect(result.result?.suggestions.length).toBeGreaterThan(0);
  });

  it("sends progress-evaluation taskType", async () => {
    engine.onTaskType("progress-evaluation", PASS_RESPONSE);
    await evaluator.evaluate({
      stepNumber: 1, stepTitle: "T", stepGoal: "G", userWork: "W",
    });
    expect(engine.calls[0]?.taskType).toBe("progress-evaluation");
  });
});
