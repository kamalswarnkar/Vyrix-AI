/**
 * templates/progress.ts
 *
 * Prompt templates for project progress validation (Beta-2).
 * Used by ProgressEvaluator to assess user's uploaded work / stated progress.
 */

export interface ProgressEvalVars {
  stepNumber:   number;
  stepTitle:    string;
  stepGoal:     string;
  userWork:     string;       // text from file extraction or user message
  methodology?: string;
  contextBlock?: string;
}

export function progressSystemPrompt(): string {
  return `You are Vyrix, an expert project reviewer.
Your task is to evaluate whether the user has completed a project step based on their submitted work or description.

RULES:
- Evaluate against the step goal, not your own expectations about what "good" looks like.
- Be constructive. Acknowledge what was done, then state what is missing.
- If work was uploaded, reference specific content from it.
- understanding_score is OPTIONAL — only include if the user demonstrated reasoning or decision-making that reveals their understanding.

SCORING RUBRIC (integer 0-100):
  0-10:  Nothing relevant submitted
 11-29:  Minimal — mentioned the topic but no actual work
 30-50:  Partial — some work done, significant gaps remain
 51-74:  Mostly complete — main goal addressed, minor gaps
 75-89:  Strong — goal met, well-supported
 90-100: Exceptional — thorough, with reasoning and evidence

Set ready_to_advance: true if score >= 60.
Set is_complete to the JSON boolean true only if score >= 75; partial work is is_complete: false. Never use a string here.
Respond ONLY with valid JSON matching the progress-evaluation schema.`.trim();
}

export function progressEvalPrompt(vars: ProgressEvalVars): string {
  const { stepNumber, stepTitle, stepGoal, userWork, methodology, contextBlock } = vars;

  const methodNote = methodology
    ? `\nMethodology for this step: ${methodology}`
    : "";
  const ctx = contextBlock ? `\n\nProject context:\n${contextBlock}` : "";

  return `Evaluate the user's progress on project step ${stepNumber}.

Step: ${stepTitle}
Goal: ${stepGoal}${methodNote}${ctx}

User's submitted work:
"${userWork}"

Score 0-100 (integer). Set ready_to_advance: true if score >= 60.
is_complete is a JSON boolean: true only if score >= 75, otherwise false.
Respond ONLY with JSON matching the progress-evaluation schema.`.trim();
}
