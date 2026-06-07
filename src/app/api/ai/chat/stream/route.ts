import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";
import { createChatCompletionRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = createChatCompletionRequestSchema.parse(json);
    const { chatService } = getAiContainer();
    const stream = await chatService.streamCompletion(input);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "CHAT_STREAM_FAILED",
      "Unknown chat stream failure",
    );
  }
}
