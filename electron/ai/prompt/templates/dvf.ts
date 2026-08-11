/**
 * templates/dvf.ts
 *
 * Prompt templates for full DVF (Desirability + Viability + Feasibility) evaluation.
 * This runs AFTER ideation — not at mission start.
 */

export interface DVFEvalVars {
  projectTitle:    string;
  problemStatement: string;
  endGoalType:     string;
  endGoalDescription: string;
  ideationConcepts: string[];
  dvfVersion:      number;
  contextBlock?:   string;
}

export function dvfSystemPrompt(): string {
  return `You are Vyrix, an expert in product strategy and innovation evaluation.
Your task is to conduct a full DVF (Desirability, Viability, Feasibility) evaluation of a project after ideation.

SCOPE:
- DESIRABILITY: Is there a real user need? Would people want this?
- VIABILITY: Can this sustain itself? Is there a plausible path to value?
- FEASIBILITY: Can this be built with the available constraints and resources?

EVIDENCE RULES — distinguish strictly:
- "evidence": stated by user or clearly factual
- "assumption": reasonable inference, not confirmed
- "unknown": cannot determine from available information
- "requires_validation": needs testing, research, or prototyping to confirm

NEVER fabricate market data. NEVER overstate confidence.
Score each dimension 0-100 (integer). Overall score = weighted average (D×0.4 + V×0.3 + F×0.3).

Respond ONLY with valid JSON matching the dvf-evaluation schema.`.trim();
}

export function dvfEvalPrompt(vars: DVFEvalVars): string {
  const { projectTitle, problemStatement, endGoalType, endGoalDescription, ideationConcepts, dvfVersion, contextBlock } = vars;

  const concepts = ideationConcepts.length > 0
    ? `\n\nConcepts from ideation:\n${ideationConcepts.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
    : "";
  const ctx = contextBlock ? `\n\nProject context:\n${contextBlock}` : "";

  return `Conduct a full DVF evaluation for this project.

Project: ${projectTitle}
Problem: ${problemStatement}
End goal type: ${endGoalType}
End goal: ${endGoalDescription}${concepts}${ctx}

Evaluate all three dimensions:
DESIRABILITY — Is there real user demand? Who needs this?
VIABILITY — Can this create and sustain value? What is the path to success?
FEASIBILITY — Can this be built given known constraints and resources?

For each dimension: provide a score (0-100), summary, evidence findings, and risks.
Set ready_for_decision: true if overall_score >= 50.
Version must be ${dvfVersion}.
Respond ONLY with JSON matching the dvf-evaluation schema.`.trim();
}
