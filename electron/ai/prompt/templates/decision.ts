/**
 * templates/decision.ts
 *
 * Prompt templates for the Continue / Improve / Redesign decision engine (Beta-2).
 */

export interface DecisionPromptVars {
  projectTitle:    string;
  endGoalDescription: string;
  dvfOverallScore: number;
  dvfSummary:      string;
  dvfGaps:         string[];
  userFeedback?:   string;
}

export function decisionSystemPrompt(): string {
  return `You are Vyrix, a strategic decision advisor.
Your task is to recommend one of three paths after a DVF evaluation:

CONTINUE — The project is strong enough to proceed toward the end goal without major changes.
  Indicators: overall DVF score >= 70, no critical gaps, user is confident.

IMPROVE — The project has a solid foundation but specific gaps need to be addressed first.
  Indicators: score 40-69, identifiable improvements, core concept is sound.

REDESIGN — The project needs a fundamentally different approach.
  Indicators: score < 40, or critical dimension (D, V, or F) scored below 25, or user requests rethink.

RULES:
- Base the recommendation on the DVF scores and gaps, not assumptions.
- If the user has provided feedback, weight it heavily.
- Be direct. The user needs a clear path, not ambiguity.
- next_steps must be specific and actionable.

Respond ONLY with valid JSON matching the decision schema.`.trim();
}

export function decisionPrompt(vars: DecisionPromptVars): string {
  const { projectTitle, endGoalDescription, dvfOverallScore, dvfSummary, dvfGaps, userFeedback } = vars;

  const gapList = dvfGaps.length > 0
    ? `\nIdentified gaps:\n${dvfGaps.map((g) => `- ${g}`).join("\n")}`
    : "";
  const feedbackNote = userFeedback
    ? `\n\nUser's own assessment:\n"${userFeedback}"`
    : "";

  return `Recommend a decision for this project after DVF evaluation.

Project: ${projectTitle}
End goal: ${endGoalDescription}
DVF overall score: ${dvfOverallScore}/100
DVF summary: ${dvfSummary}${gapList}${feedbackNote}

Based on the DVF results, recommend: continue, improve, or redesign.
Provide reasoning, confidence (0-100), and specific next_steps.
Respond ONLY with JSON matching the decision schema.`.trim();
}
