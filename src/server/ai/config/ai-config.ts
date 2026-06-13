import { z } from "zod";

const aiConfigSchema = z.object({
  ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
  defaultChatModel: z
    .enum(["llama3.2:3b-instruct"])
    .default("llama3.2:3b-instruct"),
  embeddingModel: z.string().min(1).default("nomic-embed-text"),
  sqlitePath: z.string().min(1).default("./data/vyrix.sqlite"),
  workspaceRoot: z.string().default("./data/workspace"),
  uploadStorageRoot: z.string().min(1).default("./data/uploads"),
  faissIndexDir: z.string().min(1).default("./data/faiss"),
  chatHistoryMessageLimit: z.number().int().min(4).default(20),
  requestTimeoutMs: z.number().int().min(5_000).default(120_000),
  healthCheckTimeoutMs: z.number().int().min(500).default(5_000),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

export function getAiConfig(): AiConfig {
  return aiConfigSchema.parse({
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    defaultChatModel: process.env.DEFAULT_CHAT_MODEL,
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
    sqlitePath: process.env.VYRIX_SQLITE_PATH,
    workspaceRoot: process.env.VYRIX_WORKSPACE_ROOT,
    uploadStorageRoot: process.env.VYRIX_UPLOAD_STORAGE_ROOT,
    faissIndexDir: process.env.VYRIX_FAISS_INDEX_DIR,
    chatHistoryMessageLimit: process.env.AI_CHAT_HISTORY_LIMIT
      ? Number(process.env.AI_CHAT_HISTORY_LIMIT)
      : undefined,
    requestTimeoutMs: process.env.AI_REQUEST_TIMEOUT_MS
      ? Number(process.env.AI_REQUEST_TIMEOUT_MS)
      : undefined,
    healthCheckTimeoutMs: process.env.AI_HEALTH_TIMEOUT_MS
      ? Number(process.env.AI_HEALTH_TIMEOUT_MS)
      : undefined,
  });
}
