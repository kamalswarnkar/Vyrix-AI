import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";
import { uploadDocumentRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      {
        error: {
          code: "PROJECT_ID_REQUIRED",
          message: "projectId is required to list documents.",
        },
      },
      { status: 400 },
    );
  }

  const { documentRepository } = getAiContainer();
  const documents = await documentRepository.listDocumentsByProject(projectId);

  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = uploadDocumentRequestSchema.parse(json);
    const { documentService } = getAiContainer();
    const result = await documentService.uploadDocument(input);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "DOCUMENT_UPLOAD_FAILED",
      "Unknown document upload failure",
    );
  }
}
