import { NextResponse } from "next/server";

import { AiError } from "@/server/ai/errors/ai-errors";
import { getAiContainer } from "@/server/ai/container";
import { createChatCompletionRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = createChatCompletionRequestSchema.parse(json);
    const { chatService } = getAiContainer();
    const result = await chatService.createCompletion(input);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "CHAT_REQUEST_FAILED",
          message:
            error instanceof Error ? error.message : "Unknown chat request failure",
        },
      },
      { status: 500 },
    );
  }
}
