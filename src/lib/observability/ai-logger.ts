type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  event: string;
  requestId?: string;
  conversationId?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

function write(level: LogLevel, payload: LogPayload) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    ...payload,
  };

  const line = JSON.stringify(record);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export const aiLogger = {
  info(payload: LogPayload) {
    write("info", payload);
  },
  warn(payload: LogPayload) {
    write("warn", payload);
  },
  error(payload: LogPayload) {
    write("error", payload);
  },
};
