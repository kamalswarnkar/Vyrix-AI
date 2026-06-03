export class AiError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, options?: { code?: string; statusCode?: number }) {
    super(message);
    this.name = "AiError";
    this.code = options?.code ?? "AI_ERROR";
    this.statusCode = options?.statusCode ?? 500;
  }
}

export class AiProviderUnavailableError extends AiError {
  constructor(message = "Local AI provider is unavailable") {
    super(message, {
      code: "AI_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  }
}

export class AiModelUnavailableError extends AiError {
  constructor(message = "Requested AI model is unavailable") {
    super(message, {
      code: "AI_MODEL_UNAVAILABLE",
      statusCode: 503,
    });
  }
}

export class ConversationNotFoundError extends AiError {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} was not found`, {
      code: "CONVERSATION_NOT_FOUND",
      statusCode: 404,
    });
  }
}

export class RepositoryNotConfiguredError extends AiError {
  constructor(message = "Persistence layer is not configured yet") {
    super(message, {
      code: "REPOSITORY_NOT_CONFIGURED",
      statusCode: 503,
    });
  }
}
