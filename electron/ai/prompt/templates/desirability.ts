/**
 * templates/desirability.ts
 *
 * Prompt templates for initial desirability evaluation (Beta-2).
 * IMPORTANT: This evaluates DEMAND only — not viability or feasibility.
 * Full DVF is a separate step after ideation.
 */

export interface DesirabilityEvalVars {
  projectTitle:    string;
  problemStatement: string;
  targetOutcome:   string;
  constraints?:    string[];
  resources?:      string[];
  contextBlock?:   string;
}

export function desirabilitySystemPrompt(): string {
  return `You are Vyrix, an expert in demand and problem analysis.
Your task is to evaluate whether a problem is DESIRABLE — whether there is a real user need and meaningful demand.

SCOPE: Evaluate DESIRABILITY / DEMAND only. Do NOT evaluate viability (business) or feasibility (technical).

EVIDENCE RULES — you must distinguish:
- "evidence": explicitly stated by the user or clearly factual
- "assumption": plausible inference but not confirmed
- "unknown": cannot be determined from the information given
- "requires_validation": needs market research or user research to confirm

NEVER convert an assumption into a factual claim.
NEVER fabricate market data.
SCORING RUBRIC (integer 0-100):
  0-20:  Problem is unclear or purely hypothetical with no identifiable users
 21-40:  Problem exists but demand is speculative, no clear user group
 41-60:  Problem is real, some demand is plausible, significant unknowns
 61-80:  Problem is clear, real user need is identifiable, demand is plausible
 81-100: Strong evidence of demand, clear user pain, validated or highly credible

Respond ONLY with valid JSON matching the desirability-evaluation schema.`.trim();
}

export function desirabilityEvalPrompt(vars: DesirabilityEvalVars): string {
  const { projectTitle, problemStatement, targetOutcome, constraints = [], resources = [], contextBlock } = vars;

  const constraintList = constraints.length > 0
    ? `\nConstraints: ${constraints.join(", ")}`
    : "";
  const resourceList = resources.length > 0
    ? `\nResources: ${resources.join(", ")}`
    : "";
  const ctx = contextBlock ? `\n\nAdditional context:\n${contextBlock}` : "";

  return `Evaluate the initial desirability of this project.

Project: ${projectTitle}
Problem: ${problemStatement}
Target outcome: ${targetOutcome}${constraintList}${resourceList}${ctx}

Evaluate:
1. How clearly is the problem stated?
2. Is there a real, identifiable group of people who experience this problem?
3. How strong is the demand signal? (evidence vs assumption)
4. What assumptions need validation?
5. What are the main risks to demand?
6. What research or validation steps are recommended?

Stage must be "initial_desirability". Score 0-100 (integer).
Set ready_for_ideation: true if score >= 40 (problem has enough clarity to start ideation roadmap).
Respond ONLY with JSON matching the desirability-evaluation schema.`.trim();
}
