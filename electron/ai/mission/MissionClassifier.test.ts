/**
 * MissionClassifier.test.ts
 * Unit tests for MissionClassifier — deterministic, mock-only, no live model.
 *
 * Run: npx jest electron/ai/mission/MissionClassifier.test.ts
 */

import { MissionClassifier }   from "./MissionClassifier";
import { MockPromptEngine }    from "../__tests__/mocks/MockPromptEngine";
import { SchemaValidator }     from "../validation/SchemaValidator";

const VALID_PROJECT_RESPONSE = JSON.stringify({
  mission_type:       "project",
  confidence:         85,
  reasoning:          "User described a problem with no fixed outcome.",
  understood_problem: "Build a delivery app for students.",
  detected_goals:     ["Faster delivery"],
  detected_outcomes:  ["Prototype"],
  constraints:        ["3 months"],
  resources:          ["2 developers"],
});

const VALID_SUBJECT_RESPONSE = JSON.stringify({
  mission_type:       "subject",
  confidence:         90,
  reasoning:          "User wants to study machine learning.",
  understood_problem: "Learn ML fundamentals.",
  detected_goals:     ["Understand supervised learning"],
  detected_outcomes:  ["Completed module"],
  constraints:        [],
  resources:          [],
});

let engine:     MockPromptEngine;
let validator:  SchemaValidator;
let classifier: MissionClassifier;

beforeEach(() => {
  engine    = new MockPromptEngine();
  validator = new SchemaValidator();
  classifier = new MissionClassifier(engine as any, validator);
});

// ── classify() ────────────────────────────────────────────────────────────────

describe("classify()", () => {
  it("returns a valid project classification", async () => {
    engine.onTaskType("mission-classification", VALID_PROJECT_RESPONSE);
    const result = await classifier.classify("I want to build a food delivery app");
    expect(result.ok).toBe(true);
    expect(result.classification?.mission_type).toBe("project");
    expect(result.classification?.confidence).toBe(85);
  });

  it("returns a valid subject classification", async () => {
    engine.onTaskType("mission-classification", VALID_SUBJECT_RESPONSE);
    const result = await classifier.classify("I want to learn machine learning");
    expect(result.ok).toBe(true);
    expect(result.classification?.mission_type).toBe("subject");
  });

  it("returns ok:false when model returns invalid JSON", async () => {
    engine.onTaskType("mission-classification", "not valid json");
    const result = await classifier.classify("some mission");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns ok:false when schema validation fails", async () => {
    // Missing required fields
    engine.onTaskType("mission-classification", JSON.stringify({ mission_type: "project" }));
    const result = await classifier.classify("some mission");
    expect(result.ok).toBe(false);
  });

  it("calls promptEngine with mission-classification taskType", async () => {
    engine.onTaskType("mission-classification", VALID_PROJECT_RESPONSE);
    await classifier.classify("Build something");
    expect(engine.calls[0]?.taskType).toBe("mission-classification");
  });
});

// ── confirmationMessage() ─────────────────────────────────────────────────────

describe("confirmationMessage()", () => {
  it("includes mission type and understood problem", () => {
    const classification = JSON.parse(VALID_PROJECT_RESPONSE);
    const msg = classifier.confirmationMessage(classification);
    expect(msg).toContain("PROJECT");
    expect(msg).toContain("Build a delivery app for students");
    expect(msg).toContain("Is that correct?");
  });

  it("lists detected goals when present", () => {
    const classification = JSON.parse(VALID_PROJECT_RESPONSE);
    const msg = classifier.confirmationMessage(classification);
    expect(msg).toContain("Faster delivery");
  });

  it("handles empty detected_goals gracefully", () => {
    const classification = { ...JSON.parse(VALID_SUBJECT_RESPONSE), detected_goals: undefined };
    const msg = classifier.confirmationMessage(classification);
    expect(msg).toContain("Is that correct?");
  });
});
