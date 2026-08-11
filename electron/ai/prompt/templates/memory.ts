/**
 * templates/memory.ts
 *
 * Prompt templates for the Memory Distillation pipeline (M15).
 * These prompts instruct the model to extract structured memory deltas
 * and keywords from conversation turns.
 */

export interface MemoryExtractionVars {
  /** The user's message text */
  userMessage:  string;
  /** The assistant's response text */
  aiMessage:    string;
  /** Existing memory keys (to detect updates vs. new keys) */
  existingKeys?: string[];
}

export interface KeywordExtractionVars {
  /** The user's message text */
  userMessage: string;
  /** The assistant's response text */
  aiMessage:   string;
  /** Already known keywords (to avoid duplicates) */
  existingKeywords?: string[];
}

// ─── Memory distillation system prompt ───────────────────────────────────────

export function memoryDistillationSystemPrompt(): string {
  return `You are a memory distillation engine for a strategic planning AI.
Your job is to extract the single most important fact from a conversation turn.

RULES:
- Extract only high-signal information worth remembering long-term.
- If nothing is worth remembering, return key: "no-op" and value: "".
- Prefer concise values (under 100 characters).
- Do not extract pleasantries, filler, or conversational noise.
- Respond ONLY with a valid JSON object. No text outside the JSON.

REQUIRED OUTPUT SHAPE:
{
  "key": "<short fact name, e.g. 'Frontend Framework'>",
  "value": "<fact value, e.g. 'React'>",
  "category": "<one of: technical|design|user|timeline|decision|general>",
  "confidence": <0.0-1.0 float>
}`.trim();
}

// ─── Memory extraction prompt ─────────────────────────────────────────────────

export function memoryExtractionPrompt(vars: MemoryExtractionVars): string {
  const { userMessage, aiMessage, existingKeys = [] } = vars;

  const existingKeysLine = existingKeys.length > 0
    ? `\nExisting memory keys (avoid duplicating): ${existingKeys.join(", ")}`
    : "";

  return `Extract the single most important fact from this conversation turn.
${existingKeysLine}

User: "${userMessage}"
AI: "${aiMessage}"

If there is a meaningful fact, decision, or piece of context worth remembering, extract it.
If there is nothing significant, return key: "no-op" and value: "".

Respond ONLY with JSON: {"key":"<fact name>","value":"<fact value>","category":"technical|design|user|timeline|decision|general","confidence":0.9}`.trim();
}

// ─── Keyword extraction system prompt ────────────────────────────────────────

export function keywordExtractionSystemPrompt(): string {
  return `You are a keyword extraction engine for a strategic planning AI.
Your job is to extract domain-relevant keywords and decisions from conversation turns.

RULES:
- Keywords: 1-3 words, lowercase, domain-specific nouns or noun phrases (max 20).
- Do not extract common English words (the, is, are, etc.).
- Decisions: concrete commitments or choices made by the user (max 5).
- Mark has_significant_decision: true only if a concrete commitment was made.
- Respond ONLY with a valid JSON object. No text outside the JSON.

REQUIRED OUTPUT SHAPE:
{
  "keywords": ["<term1>", "<term2>"],
  "decisions": [
    {"key": "<decision name>", "value": "<decision value>", "category": "technical|design|user|timeline|decision|general"}
  ],
  "has_significant_decision": <true|false>
}`.trim();
}

// ─── Keyword extraction prompt ────────────────────────────────────────────────

export function keywordExtractionPrompt(vars: KeywordExtractionVars): string {
  const { userMessage, aiMessage, existingKeywords = [] } = vars;

  const existingLine = existingKeywords.length > 0
    ? `\nAlready known keywords (deprioritize): ${existingKeywords.slice(0, 20).join(", ")}`
    : "";

  return `Extract domain keywords and decisions from this conversation turn.
${existingLine}

User: "${userMessage}"
AI: "${aiMessage}"

Respond with valid JSON matching the KeywordExtraction schema.`.trim();
}
