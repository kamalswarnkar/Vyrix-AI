import { z } from "zod";

export const aiModelIdSchema = z.enum([
  "qwen2.5:7b-instruct",
  "qwen2.5:14b-instruct",
  "phi3:mini",
  "phi3:medium",
]);

export const aiProviderSchema = z.enum(["ollama"]);

export const conversationScopeSchema = z.enum(["project", "workspace"]);

export const chatAttachmentSchema = z.object({
  documentId: z.string().min(1),
  chunkIds: z.array(z.string().min(1)).optional(),
  label: z.string().min(1).optional(),
});

export const createConversationRequestSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    title: z.string().min(1).max(120).optional(),
    scope: conversationScopeSchema,
    model: aiModelIdSchema,
  })
  .superRefine((input, ctx) => {
    if (input.scope === "project" && !input.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "projectId is required for project-scoped conversations",
        path: ["projectId"],
      });
    }

    if (input.scope === "workspace" && !input.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workspaceId is required for workspace-scoped conversations",
        path: ["workspaceId"],
      });
    }
  });

export const createChatCompletionRequestSchema = z.object({
  conversationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  model: aiModelIdSchema,
  provider: aiProviderSchema,
  message: z.string().trim().min(1).max(24_000),
  attachments: z.array(chatAttachmentSchema).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(8_192).optional(),
});

export type CreateConversationRequestInput = z.infer<
  typeof createConversationRequestSchema
>;

export type CreateChatCompletionRequestInput = z.infer<
  typeof createChatCompletionRequestSchema
>;
