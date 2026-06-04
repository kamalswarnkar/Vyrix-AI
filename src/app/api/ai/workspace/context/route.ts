import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { workspaceContextRequestSchema } from "@/server/ai/validators/chat-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = workspaceContextRequestSchema.parse(json);
    const { workspaceContextService } = getAiContainer();
    const workspaceRefs = await workspaceContextService.collectContext(input);

    return NextResponse.json({ workspaceRefs });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "WORKSPACE_CONTEXT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unknown workspace context failure",
        },
      },
      { status: 500 },
    );
  }
}
