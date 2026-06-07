"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AiModelId =
  | "llama3:8b-instruct"
  | "llama3.1:8b-instruct"
  | "llama3.2:3b-instruct"
  | "qwen2.5:7b-instruct"
  | "qwen2.5:14b-instruct"
  | "phi3:mini"
  | "phi3:medium";

interface BootstrapData {
  defaultChatModel: AiModelId;
  preferredChatModel: AiModelId;
  installedModelIds: string[];
  historyMessageLimit: number;
  provider: "ollama";
  models: Array<{
    id: AiModelId;
    label: string;
    recommendedUseCases: string[];
    resourceProfile: "low" | "medium" | "high";
    defaultMaxTokens: number;
    installed: boolean;
  }>;
  health: {
    ok: boolean;
    message: string;
    missingModels: string[];
    installedModels: Array<{ name: string }>;
  };
}

interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

interface UploadedDocument {
  id: string;
  name: string;
  status: string;
  kind: string;
}

interface ApiErrorPayload {
  error?: {
    message?: string;
  };
}

type ChatUiMessage = ConversationMessage & {
  pending?: boolean;
};

const DEFAULT_PROJECT_ID = "demo-project";
const STORAGE_KEY = "vyrix-demo-state";

export function ChatbotDemo() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [model, setModel] = useState<AiModelId | "">("");
  const [conversationId, setConversationId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [draft, setDraft] = useState("");
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const hydrated = readPersistedDemoState();
    const hydratedProjectId = hydrated.projectId ?? DEFAULT_PROJECT_ID;
    if (hydrated.projectId) {
      setProjectId(hydrated.projectId);
    }
    if (hydrated.model) {
      setModel(hydrated.model);
    }
    if (hydrated.conversationId) {
      setConversationId(hydrated.conversationId);
    }
    if (hydrated.draft) {
      setDraft(hydrated.draft);
    }
    if (typeof hydrated.includeWorkspace === "boolean") {
      setIncludeWorkspace(hydrated.includeWorkspace);
    }

    void initialize(hydratedProjectId);
  }, []);

  useEffect(() => {
    if (!loading) {
      setConversationId("");
      setMessages([]);
      void refreshProjectData(projectId);
    }
  }, [loading, projectId]);

  useEffect(() => {
    persistDemoState({
      projectId,
      model,
      conversationId,
      draft,
      includeWorkspace,
    });
  }, [conversationId, draft, includeWorkspace, model, projectId]);

  async function initialize(targetProjectId = projectId) {
    try {
      setLoading(true);
      setError(null);

      const bootstrapResponse = await fetchWithTimeout("/api/ai/bootstrap");
      const bootstrapJson = (await bootstrapResponse.json()) as BootstrapData | ApiErrorPayload;

      if (!bootstrapResponse.ok || !("defaultChatModel" in bootstrapJson)) {
        throw new Error(
          "error" in bootstrapJson && bootstrapJson.error?.message
            ? bootstrapJson.error.message
            : "Failed to load chatbot bootstrap data.",
        );
      }

      setBootstrap(bootstrapJson);
      setModel((currentModel) => {
        if (!currentModel) {
          return bootstrapJson.preferredChatModel;
        }

        return bootstrapJson.installedModelIds.includes(currentModel)
          ? currentModel
          : bootstrapJson.preferredChatModel;
      });
      await refreshProjectData(targetProjectId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load demo.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshProjectData(targetProjectId: string) {
    await Promise.all([loadConversations(targetProjectId), loadDocuments(targetProjectId)]);
  }

  async function loadConversations(targetProjectId: string) {
    const response = await fetchWithTimeout(
      `/api/ai/conversations?projectId=${encodeURIComponent(targetProjectId)}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      setConversations([]);
      return;
    }

    const json = (await response.json()) as { conversations: ConversationSummary[] };
    setConversations(json.conversations);
  }

  async function loadDocuments(targetProjectId: string) {
    const response = await fetchWithTimeout(
      `/api/ai/documents?projectId=${encodeURIComponent(targetProjectId)}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      setDocuments([]);
      return;
    }

    const json = (await response.json()) as { documents: UploadedDocument[] };
    setDocuments(json.documents);
  }

  async function ensureConversation(titleSource: string): Promise<string> {
    if (conversationId) {
      return conversationId;
    }

    if (!model) {
      throw new Error("Choose a model before starting a conversation.");
    }

    const response = await fetchWithTimeout("/api/ai/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        scope: "project",
        model,
        title: titleSource.trim().slice(0, 60) || "Demo Conversation",
      }),
    });
    const json = (await response.json()) as
      | { conversation: ConversationSummary }
      | ApiErrorPayload;

    if (!response.ok || !("conversation" in json)) {
      throw new Error(
        "error" in json && json.error?.message
          ? json.error.message
          : "Failed to create a conversation.",
      );
    }

    setConversationId(json.conversation.id);
    setConversations((current) => [json.conversation, ...current]);
    return json.conversation.id;
  }

  async function handleStartFresh() {
    setConversationId("");
    setMessages([]);
    setError(null);
  }

  async function handleLoadConversation(id: string) {
    try {
      setBusy(true);
      setError(null);
      const response = await fetchWithTimeout(
        `/api/ai/conversations/${encodeURIComponent(id)}`,
        {
          cache: "no-store",
        },
      );
      const json = (await response.json()) as
        | { conversation: ConversationSummary; messages: ConversationMessage[] }
        | ApiErrorPayload;

      if (!response.ok || !("messages" in json)) {
        throw new Error(
          "error" in json && json.error?.message
            ? json.error.message
            : "Failed to load conversation.",
        );
      }

      setConversationId(json.conversation.id);
      setMessages(json.messages);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load conversation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = draft.trim();
    if (!message || busy) {
      return;
    }

    try {
      setBusy(true);
      setError(null);

      if (bootstrap && !bootstrap.health.ok) {
        throw new Error(bootstrap.health.message);
      }

      const activeConversationId = await ensureConversation(message);
      const optimisticUserId = `user-${Date.now()}`;
      const assistantId = `assistant-${Date.now()}`;
      const activeModel =
        bootstrap?.models.find((entry) => entry.id === model) ?? null;

      const response = await fetchWithTimeout("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          projectId,
          model,
          provider: "ollama",
          message,
          stream: true,
          maxTokens: activeModel?.defaultMaxTokens,
          context: {
            includeWorkspace,
            topK: 3,
          },
        }),
      });

      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
        const errorJson = (await response.json().catch(() => null)) as ApiErrorPayload | null;
        throw new Error(errorJson?.error?.message ?? "Streaming request failed.");
      }

      setMessages((current) => [
        ...current,
        {
          id: optimisticUserId,
          role: "user",
          content: message,
          createdAt: new Date().toISOString(),
        },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          pending: true,
        },
      ]);
      setDraft("");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((entry) => entry.startsWith("data: "));

          if (!line) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as {
            type: string;
            delta?: string;
            error?: { message?: string };
          };

          if (payload.type === "message.delta" && payload.delta) {
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId
                  ? {
                      ...entry,
                      content: entry.content + payload.delta,
                    }
                  : entry,
              ),
            );
          }

          if (payload.type === "message.completed") {
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId
                  ? {
                      ...entry,
                      pending: false,
                    }
                  : entry,
              ),
            );
          }

          if (payload.type === "error") {
            throw new Error(payload.error?.message ?? "The model stream failed.");
          }
        }
      }

      await Promise.all([loadConversations(projectId), refreshConversation(activeConversationId)]);
    } catch (caughtError) {
      setMessages((current) => {
        if (
          current.length >= 2 &&
          current[current.length - 1]?.role === "assistant" &&
          current[current.length - 2]?.role === "user" &&
          current[current.length - 2]?.content === message
        ) {
          return current.map((entry, index) =>
            index === current.length - 1
              ? {
                  ...entry,
                  pending: false,
                  content:
                    entry.content ||
                    "The assistant could not complete this reply. Check runtime status and installed models.",
                }
              : entry,
          );
        }

        return current;
      });
      setDraft((currentDraft) => currentDraft || message);
      setError(caughtError instanceof Error ? caughtError.message : "Failed to send message.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshConversation(id: string) {
    const response = await fetchWithTimeout(`/api/ai/conversations/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    const json = (await response.json()) as {
      conversation: ConversationSummary;
      messages: ConversationMessage[];
    };
    setMessages(json.messages);
  }

  async function handleUploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setUploadNote(null);
      setBusy(true);
      setSelectedFileName(file.name);
      const base64 = await fileToBase64(file);
      const response = await fetchWithTimeout("/api/ai/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: base64,
        }),
      });
      const json = (await response.json()) as
        | { document: UploadedDocument; chunksCreated: number; warning?: string }
        | ApiErrorPayload;

      if (!response.ok || !("document" in json)) {
        throw new Error(
          "error" in json && json.error?.message
            ? json.error.message
            : "Document upload failed.",
        );
      }

      setUploadNote(
        json.warning
          ? `${json.document.name} uploaded with warning: ${json.warning}`
          : `${json.document.name} uploaded successfully with ${json.chunksCreated} chunk(s).`,
      );
      await loadDocuments(projectId);
      setSelectedFileName(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDocument(documentId: string) {
    try {
      setBusy(true);
      setError(null);
      const response = await fetchWithTimeout(
        `/api/ai/documents/${encodeURIComponent(documentId)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as ApiErrorPayload | null;
        throw new Error(json?.error?.message ?? "Document removal failed.");
      }

      setDocuments((current) => current.filter((document) => document.id !== documentId));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to remove document.",
      );
    } finally {
      setBusy(false);
    }
  }

  const healthClassName = useMemo(() => {
    if (!bootstrap) {
      return "status-pill warn";
    }

    if (!bootstrap.health.ok) {
      return "status-pill error";
    }

    if (bootstrap.health.installedModels.length > 0) {
      return "status-pill ok";
    }

    return "status-pill warn";
  }, [bootstrap]);

  return (
    <main className="demo-shell">
      <section className="hero">
        <div className="hero-card">
          <div className="eyebrow">Vyrix Temporary Demo</div>
          <h1>Local-first chatbot demo for research workflows.</h1>
          <p>
            This lightweight interface uses the real Vyrix API routes. It lets us
            create conversations, stream assistant replies from Ollama, inspect
            runtime health, and upload small context files for retrieval-backed chat.
          </p>
        </div>
      </section>

      <section className="layout">
        <aside className="sidebar">
          <div className="status-card">
            <h2>Runtime Status</h2>
            <div className={healthClassName}>
              {bootstrap?.health.ok
                ? bootstrap.health.installedModels.length > 0
                  ? "Operational"
                  : "Reachable, install a model"
                : "Runtime unavailable"}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              {bootstrap?.health.message ??
                (loading ? "Checking local AI runtime..." : "Bootstrap data unavailable.")}
            </p>
          </div>

          <div className="panel">
            <h2>Session Controls</h2>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="projectId">Project ID</label>
                <input
                  id="projectId"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="demo-project"
                />
              </div>

              <div className="field">
                <label htmlFor="model">Model</label>
                <select
                  id="model"
                  value={model}
                  onChange={(event) => setModel(event.target.value as AiModelId)}
                >
                  {bootstrap?.models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label} ({entry.resourceProfile}
                      {entry.installed ? ", installed" : ", not installed"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={includeWorkspace}
                    onChange={(event) => setIncludeWorkspace(event.target.checked)}
                  />{" "}
                  Include workspace context
                </label>
              </div>

              <div className="action-row">
                <button className="button" type="button" onClick={() => void initialize()}>
                  Refresh status
                </button>
                <button className="button" type="button" onClick={() => void handleStartFresh()}>
                  New chat
                </button>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Upload Context</h2>
            <p className="muted">
              Upload a small file so retrieval can reference it in later prompts.
            </p>
            <div className="action-row">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(event) => void handleUploadFile(event)}
                disabled={busy}
              />
            </div>
            {selectedFileName ? <p className="muted">Selected file: {selectedFileName}</p> : null}
            {uploadNote ? <p className="muted">{uploadNote}</p> : null}
            <div className="support-list">
              {documents.length === 0 ? (
                <div className="support-item">
                  <strong>No uploaded documents yet.</strong>
                  Upload `txt`, `md`, `html`, `pdf`, `png`, or `jpeg` to test the pipeline.
                </div>
              ) : (
                documents.map((document) => (
                  <div className="support-item" key={document.id}>
                    <strong>{document.name}</strong>
                    <div className="muted">
                      {document.kind} - {document.status}
                    </div>
                    <div className="action-row" style={{ marginTop: 8 }}>
                      <button
                        className="button"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRemoveDocument(document.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="chat-panel">
          <div>
            <h2>Chat</h2>
            <div className="meta-row muted">
              <span>Provider: {bootstrap?.provider ?? "ollama"}</span>
              <span>Conversation: {conversationId || "new"}</span>
              <span>History cap: {bootstrap?.historyMessageLimit ?? "-"}</span>
            </div>
          </div>

          {error ? <div className="inline-notice">{error}</div> : null}

          <div className="message-list">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div>
                  <strong>Start the demo with a research-style prompt.</strong>
                  <p>
                    Try asking for a literature-review plan, methodology critique, or a
                    summary of an uploaded note.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-meta">
                    {message.role}
                    {message.pending ? " - streaming" : ""}
                  </div>
                  <div className="message-content">{message.content || "..."}</div>
                </article>
              ))
            )}
          </div>

          <form className="composer" onSubmit={(event) => void handleSendMessage(event)}>
            <div className="field">
              <label htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask Vyrix to analyze a paper, critique a method, or summarize uploaded context."
              />
            </div>
            <div className="action-row">
              <button className="button primary" disabled={busy || !draft.trim()} type="submit">
                {busy ? "Thinking..." : "Send message"}
              </button>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void loadConversations(projectId)}
              >
                Refresh conversations
              </button>
            </div>
          </form>

          <div>
            <h2>Recent Conversations</h2>
            <div className="support-list">
              {conversations.length === 0 ? (
                <div className="support-item">
                  <strong>No saved conversations yet.</strong>
                  The first message creates one automatically.
                </div>
              ) : (
                conversations.map((conversation) => (
                  <button
                    className="support-item"
                    key={conversation.id}
                    onClick={() => void handleLoadConversation(conversation.id)}
                    type="button"
                  >
                    <strong>{conversation.title}</strong>
                    <div className="muted">
                      {conversation.messageCount} messages - updated{" "}
                      {new Date(conversation.updatedAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 6_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The Vyrix backend took too long to respond. Check the server and AI runtime.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function readPersistedDemoState() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw
      ? (JSON.parse(raw) as {
          projectId?: string;
          model?: AiModelId;
          draft?: string;
          includeWorkspace?: boolean;
          conversationId?: string;
        })
      : {};
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function persistDemoState(input: {
  projectId: string;
  model: AiModelId | "";
  conversationId: string;
  draft: string;
  includeWorkspace: boolean;
}) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      projectId: input.projectId,
      model: input.model || undefined,
      conversationId: input.conversationId || undefined,
      draft: input.draft,
      includeWorkspace: input.includeWorkspace,
    }),
  );
}
