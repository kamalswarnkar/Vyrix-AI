import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AiError } from "@/server/ai/errors/ai-errors";

export function toRouteErrorResponse(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "The request body or query parameters are invalid.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

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
        code: fallbackCode,
        message: error instanceof Error ? error.message : fallbackMessage,
      },
    },
    { status: 500 },
  );
}
