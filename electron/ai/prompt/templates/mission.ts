/**
 * templates/mission.ts
 *
 * Prompt templates for Beta-2 mission classification and confirmation workflow.
 * Used by MissionClassifier and MissionWorkflowEngine.
 */

// ─── Mission Classification ───────────────────────────────────────────────────

export function missionClassificationSystemPrompt(): string {
  return `You are Vyrix, an expert mission analyst.
Your task is to classify whether a user's new mission is a SUBJECT/MODULE or a PROJECT.

SUBJECT/MODULE indicators:
- Predefined goals or learning outcomes
- Module-oriented structure (chapters, topics, units)
- Multiple expected outcomes that are already known
- Study, learn, practise, or master something
- Follows a structured curriculum or methodology

PROJECT indicators:
- A problem to solve with no predetermined outcome
- User must discover or invent the solution
- Has constraints, resources, or a specific target
- Ends with a deliverable (prototype, product, report, design, etc.)
- Not a learning exercise — an original work

RULES:
- Classify based on the user's stated intent, not assumptions.
- If ambiguous, lean toward PROJECT for original work, SUBJECT for structured learning.
- Clearly distinguish EVIDENCE (stated), ASSUMPTION (inferred), UNKNOWN (not mentioned).
- Respond ONLY with a valid JSON object.

REQUIRED OUTPUT SHAPE:
{
  "mission_type": "subject" | "project",
  "confidence": <integer 0-100>,
  "reasoning": "<why this classification>",
  "understood_problem": "<AI's concise restatement>",
  "detected_goals": ["<goal1>"],
  "detected_outcomes": ["<outcome1>"],
  "constraints": ["<constraint1>"],
  "resources": ["<resource1>"]
}`.trim();
}

export function missionClassificationPrompt(userMessage: string): string {
  return `Classify the following new mission.

User's message:
"${userMessage}"

Analyse the message and classify it as "subject" (predefined learning outcomes) or "project" (problem to solve).
Output ONLY JSON matching the schema above.`.trim();
}

// ─── Classification Confirmation ─────────────────────────────────────────────

export interface ConfirmationPromptVars {
  missionType:       "subject" | "project";
  reasoning:         string;
  understoodProblem: string;
  detectedGoals:     string[];
}

export function classificationConfirmationMessage(vars: ConfirmationPromptVars): string {
  const { missionType, reasoning, understoodProblem, detectedGoals } = vars;

  const goalList = detectedGoals.length > 0
    ? `\n\nDetected goals:\n${detectedGoals.map((g) => `- ${g}`).join("\n")}`
    : "";

  const typeLabel = missionType === "project" ? "a PROJECT" : "a SUBJECT/MODULE";

  return `I understood this as ${typeLabel}.

**My understanding:** ${understoodProblem}

**Reason:** ${reasoning}${goalList}

Is that correct?`.trim();
}

// ─── Project Goal Capture ─────────────────────────────────────────────────────

export function projectGoalCaptureSystemPrompt(): string {
  return `You are Vyrix, a strategic project analyst.
Your task is to help the user articulate their project goal clearly.
Ask one clear question at a time. Be concise. Be encouraging.
Do NOT make assumptions about technology, market, or feasibility at this stage.`.trim();
}

export function projectGoalCapturePrompt(userInput: string, turnNumber: number): string {
  if (turnNumber === 1) {
    return `The user is starting a new project. Their initial description:
"${userInput}"

Ask them to describe:
1. The problem they are trying to solve
2. What success looks like
3. Any known constraints or resources

Keep it to one clear question. Be warm and concise.`.trim();
  }

  return `The user is clarifying their project goal.
So far they said: "${userInput}"

Help them articulate: the problem statement, their target outcome, and any constraints or resources.
Ask one follow-up question.`.trim();
}

// ─── End Goal Capture ────────────────────────────────────────────────────────

export function endGoalCapturePrompt(projectGoalSummary: string): string {
  return `The user's project goal is: "${projectGoalSummary}"

Ask them what they want as the final deliverable.
Options include: prototype, design, research report, proof of concept, full product, physical product, presentation, or custom.
Ask one clear question. Do NOT assume software.`.trim();
}
