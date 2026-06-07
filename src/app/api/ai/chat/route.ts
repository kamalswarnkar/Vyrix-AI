import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";
import { createChatCompletionRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = createChatCompletionRequestSchema.parse(json);
    const { chatService } = getAiContainer();
    const result = await chatService.createCompletion(input);

    return NextResponse.json(result);
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "CHAT_REQUEST_FAILED",
      "Unknown chat request failure",
    );
  }
}
