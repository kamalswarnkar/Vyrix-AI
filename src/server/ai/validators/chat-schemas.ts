import { z } from "zod";

const MAX_UPLOAD_BASE64_LENGTH = 70_000_000;
const supportedUploadMimeTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/markdown",
  "text/html",
  "application/octet-stream",
] as const;

export const aiModelIdSchema = z.enum([
  "llama3:8b-instruct",
  "llama3.1:8b-instruct",
  "llama3.2:3b-instruct",
]);

export const aiProviderSchema = z.enum(["ollama"]);

export const conversationScopeSchema = z.enum(["project", "workspace"]);

export const chatAttachmentSchema = z.object({
  documentId: z.string().min(1),
  chunkIds: z.array(z.string().min(1)).optional(),
  label: z.string().min(1).optional(),
  kind: z.enum(["pdf", "image", "text", "workspace"]).optional(),
  summary: z.string().min(1).max(4_000).optional(),
});

export const workspaceContextRefSchema = z.object({
  path: z.string().min(1).max(1_000),
  kind: z.enum(["file", "directory"]),
  language: z.string().min(1).max(80).optional(),
  summary: z.string().min(1).max(4_000).optional(),
  excerpt: z.string().min(1).max(12_000).optional(),
});

export const chatContextSelectionSchema = z.object({
  includeWorkspace: z.boolean().optional(),
  workspaceRefs: z.array(workspaceContextRefSchema).max(50).optional(),
  attachmentRefs: z.array(chatAttachmentSchema).max(50).optional(),
  retrievalQuery: z.string().trim().min(1).max(2_000).optional(),
  topK: z.number().int().min(1).max(20).optional(),
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
  context: chatContextSelectionSchema.optional(),
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

export const uploadDocumentRequestSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(240),
  mimeType: z.enum(supportedUploadMimeTypes),
  contentBase64: z
    .string()
    .min(1)
    .max(MAX_UPLOAD_BASE64_LENGTH)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const retrieveDocumentRequestSchema = z.object({
  projectId: z.string().min(1),
  documentId: z.string().min(1).optional(),
  query: z.string().trim().min(1).max(4_000),
  topK: z.number().int().min(1).max(20).optional(),
});

export const workspaceContextRequestSchema = z.object({
  rootPath: z.string().min(1).optional(),
  query: z.string().trim().min(1).max(2_000).optional(),
  maxFiles: z.number().int().min(1).max(50).optional(),
});
