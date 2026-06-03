import { z } from "zod";

const aiConfigSchema = z.object({
  ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
  defaultChatModel: z.enum([
    "qwen2.5:7b-instruct",
    "qwen2.5:14b-instruct",
    "phi3:mini",
    "phi3:medium",
  ]),
  sqlitePath: z.string().min(1).default("./data/vyrix.sqlite"),
  chatHistoryMessageLimit: z.number().int().min(4).default(20),
  requestTimeoutMs: z.number().int().min(5_000).default(120_000),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

export function getAiConfig(): AiConfig {
  return aiConfigSchema.parse({
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    defaultChatModel: process.env.DEFAULT_CHAT_MODEL,
    sqlitePath: process.env.VYRIX_SQLITE_PATH,
    chatHistoryMessageLimit: process.env.AI_CHAT_HISTORY_LIMIT
      ? Number(process.env.AI_CHAT_HISTORY_LIMIT)
      : undefined,
    requestTimeoutMs: process.env.AI_REQUEST_TIMEOUT_MS
      ? Number(process.env.AI_REQUEST_TIMEOUT_MS)
      : undefined,
  });
}
