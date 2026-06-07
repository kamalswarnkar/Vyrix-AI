import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const { documentService } = getAiContainer();
    await documentService.deleteDocument(params.documentId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "DOCUMENT_DELETE_FAILED",
      "Unknown document delete failure",
    );
  }
}
