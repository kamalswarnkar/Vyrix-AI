# Vyrix AI

A **local-first, privacy-preserving AI research assistant** built for PhD students and academic researchers. Runs entirely on-device via [Ollama](https://ollama.com) — no cloud calls, no data leaves the machine.

Vyrix is designed as a **self-contained feature module** that can be dropped into a larger Next.js application. It exposes a clean REST API, a SQLite-backed persistence layer, and a FAISS vector index — everything a host application needs to add research-grade AI capabilities.

---

## Table of Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Local development](#local-development)
- [Docker deployment](#docker-deployment)
- [Configuration reference](#configuration-reference)
- [API reference](#api-reference)
- [Document pipeline](#document-pipeline)
- [RAG and retrieval](#rag-and-retrieval)
- [Fine-tuning](#fine-tuning)
- [Integration guide](#integration-guide)
- [Known limitations](#known-limitations)

---

## What it does

- **Research-only chat** — strictly scoped to academic tasks: literature review, methodology critique, statistical interpretation, experimental design, academic writing, thesis structure, peer review, and research ethics. Off-topic requests are rejected with a fixed refusal message.
- **Document RAG** — upload PDFs, Word docs, Markdown, plain text, HTML, or images; the pipeline extracts text, chunks it paragraph-aware, embeds it with `nomic-embed-text`, and stores it in a FAISS index. Chat automatically retrieves the most relevant chunks as context.
- **Workspace context** — optionally inject local project files into the prompt so the assistant understands the current research workspace.
- **Streaming and non-streaming chat** — SSE streaming for real-time responses; synchronous endpoint for simple integrations.
- **Persistent conversations** — all conversations, messages, documents, and vectors are persisted in SQLite.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Host application                      │
│  (calls Vyrix REST API — projectId scopes all resources)    │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼─────────────────────────────────┐
│                     Next.js API routes                       │
│  /api/ai/health          /api/ai/chat                        │
│  /api/ai/chat/stream     /api/ai/conversations               │
│  /api/ai/documents       /api/ai/retrieve                    │
│  /api/ai/workspace/context                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                       Service layer                          │
│  ChatService   DocumentService   EmbeddingService            │
│  RetrievalService   WorkspaceContextService                  │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
┌──────────▼────────┐          ┌──────────▼───────────────────┐
│   Ollama (local)  │          │      Persistence              │
│                   │          │  SQLite (conversations,        │
│  llama3.2:3b      │          │  messages, documents, chunks, │
│  nomic-embed-text │          │  vector metadata)             │
│                   │          │                               │
└───────────────────┘          │  FAISS IndexFlatIP            │
                               │  (vector search, per-project, │
                               │   on-disk .faiss + .map.json) │
                               └───────────────────────────────┘
```

All resources are **scoped by `projectId`**. A single Vyrix deployment can serve multiple isolated projects (e.g. one per user or research group) — each gets its own conversation history, document store, and FAISS index.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16, React 19 (App Router) |
| Runtime model | Ollama — `llama3.2:3b-instruct` |
| Embedding model | Ollama — `nomic-embed-text` |
| Vector index | FAISS `IndexFlatIP` via `faiss-node` (C++ bindings) |
| Database | SQLite via `better-sqlite3` |
| PDF extraction | `pdf-parse` |
| DOCX extraction | `mammoth` |
| Image OCR | `tesseract.js` |
| Validation | Zod |
| Language | TypeScript (strict) |
| Tests | Vitest |
| Container | Docker + Docker Compose |

---

## Prerequisites

### Local development

- **Node.js 22+**
- **Ollama** — install from [ollama.com](https://ollama.com), then pull both models:

```bash
ollama pull llama3.2:3b-instruct
ollama pull nomic-embed-text
```

### Docker

- Docker Engine 24+ and Docker Compose v2
- No local Ollama install needed — the stack manages it

---

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (Ollama must already be running)
npm run dev

# 3. Open the demo UI
open http://localhost:3000
```

Run the test suite:

```bash
npm test
```

Type-check without emitting:

```bash
npx tsc --noEmit
```

Data is stored under `./data/` by default:

```
data/
  vyrix.sqlite       # conversations, messages, documents, chunks, vectors
  faiss/             # per-project FAISS index files
  uploads/           # raw uploaded document files
  workspace/         # workspace files scanned for context
```

---

## Docker deployment

The stack runs three containers: **ollama** (LLM server), **ollama-init** (one-shot model puller), and **vyrix** (Next.js app).

```bash
# Build and start everything
docker compose up -d

# Watch model download progress (first run pulls ~2 GB)
docker logs -f vyrix-ollama-init

# Tail application logs
docker logs -f vyrix-app

# Stop without deleting data volumes
docker compose down

# Stop and delete all data
docker compose down -v
```

The app is available at `http://localhost:3000` once the `vyrix-app` healthcheck passes.

### GPU (NVIDIA)

```bash
docker compose --profile gpu up -d
```

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

### Persisted volumes

| Volume | Contents |
|---|---|
| `ollama_data` | Downloaded model weights (`~/.ollama`) |
| `vyrix_data` | SQLite database, FAISS indexes, uploaded documents |

Both volumes survive `docker compose down` and are removed only with `docker compose down -v`.

---

## Configuration reference

All settings are read from environment variables at startup. Every variable has a sensible default so the app runs with zero configuration.

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server URL |
| `DEFAULT_CHAT_MODEL` | `llama3.2:3b-instruct` | Must be exactly this value |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `VYRIX_SQLITE_PATH` | `./data/vyrix.sqlite` | SQLite database file path |
| `VYRIX_UPLOAD_STORAGE_ROOT` | `./data/uploads` | Directory for uploaded document files |
| `VYRIX_FAISS_INDEX_DIR` | `./data/faiss` | Directory for FAISS index files |
| `VYRIX_WORKSPACE_ROOT` | `./data/workspace` | Root path scanned for workspace context |
| `AI_REQUEST_TIMEOUT_MS` | `120000` | Ollama request timeout (ms) |
| `AI_HEALTH_TIMEOUT_MS` | `5000` | Ollama health-check timeout (ms) |
| `AI_CHAT_HISTORY_LIMIT` | `20` | Max messages loaded per conversation for context |

For local development, create a `.env.local` file in the project root (it is gitignored by default):

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
VYRIX_SQLITE_PATH=./data/vyrix.sqlite
VYRIX_FAISS_INDEX_DIR=./data/faiss
VYRIX_UPLOAD_STORAGE_ROOT=./data/uploads
VYRIX_WORKSPACE_ROOT=./data/workspace
```

---

## API reference

All routes are under `/api/ai`. All request and response bodies are JSON unless noted. All write endpoints validate their input with Zod; validation errors return `400` with an `errors` array.

### Health

#### `GET /api/ai/health`

Returns Ollama connectivity status and model availability.

**Response `200`**
```json
{
  "ok": true,
  "ollamaReachable": true,
  "modelAvailable": true,
  "model": "llama3.2:3b-instruct",
  "baseUrl": "http://ollama:11434"
}
```

Returns `503` with `"ok": false` if Ollama is unreachable or the model is not pulled.

---

### Conversations

#### `GET /api/ai/conversations?projectId=<id>`

List all conversations for a project, ordered by most recently updated.

**Response `200`**
```json
{
  "conversations": [
    {
      "id": "abc123",
      "projectId": "proj_1",
      "title": "Methodology review",
      "scope": "project",
      "model": "llama3.2:3b-instruct",
      "messageCount": 12,
      "lastMessageAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-15T09:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### `POST /api/ai/conversations`

Create a new conversation.

**Request**
```json
{
  "projectId": "proj_1",
  "title": "Literature review session",
  "scope": "project",
  "model": "llama3.2:3b-instruct"
}
```

`scope` must be `"project"` (requires `projectId`) or `"workspace"` (requires `workspaceId`).

**Response `201`**
```json
{
  "conversation": { "id": "abc123", "..." }
}
```

#### `GET /api/ai/conversations/:conversationId/messages`

Fetch all messages in a conversation.

**Response `200`**
```json
{
  "messages": [
    {
      "id": "msg_1",
      "conversationId": "abc123",
      "role": "user",
      "content": "Can you explain p-value correction?",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

#### `DELETE /api/ai/conversations/:conversationId`

Delete a conversation and all its messages.

**Response `200`**
```json
{ "deleted": true, "conversationId": "abc123" }
```

---

### Chat

The model is fixed to `llama3.2:3b-instruct`. Passing any other value is rejected with `400`.

#### `POST /api/ai/chat`

Non-streaming chat completion. Sends a message and waits for the full response.

**Request**
```json
{
  "conversationId": "abc123",
  "projectId": "proj_1",
  "model": "llama3.2:3b-instruct",
  "provider": "ollama",
  "message": "What are the main threats to internal validity in RCTs?",
  "context": {
    "retrievalQuery": "internal validity randomised controlled trial",
    "topK": 6
  }
}
```

**Optional context fields**

| Field | Type | Description |
|---|---|---|
| `retrievalQuery` | `string` | Query used to retrieve relevant document chunks via FAISS |
| `topK` | `number` (1–20) | Number of chunks to retrieve (default: 6) |
| `attachmentRefs` | `ChatAttachmentRef[]` | Explicit document references to inject |
| `includeWorkspace` | `boolean` | Include workspace file context in the prompt |

**Response `200`**
```json
{
  "conversation": { "id": "abc123", "messageCount": 4, "..." },
  "userMessage": { "id": "msg_3", "role": "user", "content": "...", "..." },
  "assistantMessage": {
    "id": "msg_4",
    "role": "assistant",
    "content": "## Internal validity threats in RCTs\n\n...",
    "latencyMs": 3200,
    "promptTokens": 512,
    "completionTokens": 310,
    "..."
  }
}
```

#### `POST /api/ai/chat/stream`

Streaming chat completion via Server-Sent Events.

Same request body as `POST /api/ai/chat`.

**Response** — `Content-Type: text/event-stream`

Each event is a JSON object on a `data:` line:

```
data: {"type":"conversation.created","requestId":"req_1","conversationId":"abc123"}

data: {"type":"message.started","requestId":"req_1","conversationId":"abc123","messageId":"msg_4"}

data: {"type":"message.delta","requestId":"req_1","conversationId":"abc123","messageId":"msg_4","delta":"## Internal"}

data: {"type":"message.delta","requestId":"req_1","conversationId":"abc123","messageId":"msg_4","delta":" validity"}

data: {"type":"message.completed","requestId":"req_1","conversationId":"abc123","messageId":"msg_4","done":true}
```

On error:
```
data: {"type":"error","requestId":"req_1","conversationId":"abc123","error":{"code":"CHAT_STREAM_FAILED","message":"..."}}
```

---

### Documents

#### `GET /api/ai/documents?projectId=<id>`

List all documents uploaded to a project.

**Response `200`**
```json
{
  "documents": [
    {
      "id": "doc_1",
      "projectId": "proj_1",
      "name": "methods_chapter.pdf",
      "kind": "pdf",
      "sizeBytes": 204800,
      "status": "indexed",
      "embeddingModel": "nomic-embed-text",
      "createdAt": "2024-01-15T08:00:00Z"
    }
  ]
}
```

**Document status lifecycle**

```
uploaded → parsed → chunking → indexed
                 ↘ failed
```

#### `POST /api/ai/documents`

Upload a document. Content must be base64-encoded.

**Request**
```json
{
  "projectId": "proj_1",
  "fileName": "thesis_draft.pdf",
  "mimeType": "application/pdf",
  "contentBase64": "<base64-encoded file content>"
}
```

**Supported MIME types**

| MIME type | Parsed as |
|---|---|
| `application/pdf` | PDF text extraction |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | DOCX via mammoth |
| `text/plain` | Raw text |
| `text/markdown` | Raw text |
| `text/html` | Raw HTML |
| `image/png`, `image/jpeg` | OCR via tesseract.js |
| `application/octet-stream` | Treated as plain text |

Upload limit: ~52 MB (70 000 000 base64 chars).

**Response `201`**
```json
{
  "document": { "id": "doc_1", "status": "indexed", "..." },
  "chunksCreated": 24,
  "warning": null
}
```

Uploading the same file to the same project (matched by SHA-256) is idempotent — returns the existing record.

#### `DELETE /api/ai/documents/:documentId`

Delete a document, its chunks, its stored file, and its vectors. The project's FAISS index is automatically rebuilt after deletion.

**Response `200`**
```json
{ "deleted": true, "documentId": "doc_1" }
```

---

### Retrieval

#### `POST /api/ai/retrieve`

Run a standalone semantic similarity search against a project's FAISS index. Useful for debugging retrieval quality or building custom UI.

**Request**
```json
{
  "projectId": "proj_1",
  "query": "Bonferroni correction multiple comparisons",
  "topK": 5
}
```

**Response `200`**
```json
{
  "hits": [
    {
      "chunkId": "chunk_42",
      "documentId": "doc_1",
      "documentName": "statistics_notes.pdf",
      "content": "When conducting multiple comparisons...",
      "score": 0.87,
      "pageStart": 3
    }
  ],
  "citations": [
    { "documentName": "statistics_notes.pdf", "page": 3, "excerpt": "..." }
  ],
  "diagnostics": {
    "query": "Bonferroni correction multiple comparisons",
    "topKRequested": 5,
    "topKReturned": 3
  }
}
```

---

### Workspace context

#### `POST /api/ai/workspace/context`

Collect file excerpts from the configured workspace directory. The result can be passed directly as `workspaceRefs` in a chat request.

**Request**
```json
{
  "query": "data preprocessing pipeline",
  "maxFiles": 10
}
```

**Response `200`**
```json
{
  "workspaceRefs": [
    {
      "path": "src/preprocessing/normalize.py",
      "kind": "file",
      "language": "python",
      "excerpt": "def normalize_batch(X: np.ndarray) -> np.ndarray:..."
    }
  ]
}
```

---

## Document pipeline

When a document is uploaded the following happens synchronously:

1. **SHA-256 deduplication** — if the same file has been uploaded to the same project before, the existing record is returned immediately.
2. **Text extraction** — varies by file type (see supported types above). Returns `warning` if extraction yields no usable text.
3. **Paragraph-aware chunking** — text is split on `\n\n` boundaries before hitting the 4 000-character chunk size. Each chunk overlaps by one paragraph with the previous. Page estimates are stored per chunk.
4. **Embedding** — chunks are embedded in batches of 4 using `nomic-embed-text` via Ollama. Concurrency is capped at 4 parallel calls.
5. **FAISS indexing** — vectors are L2-normalised and added to a per-project `IndexFlatIP` (exact inner-product search). The index is persisted to disk as `{projectId}__{model}.faiss` + `.map.json`.
6. **SQLite metadata** — document, chunk, and vector metadata (including the raw vector) are written to SQLite. This is the source of truth used to rebuild the FAISS index after a deletion.

FAISS falls back to an in-memory brute-force cosine search if the native binary fails to load.

---

## RAG and retrieval

When `context.retrievalQuery` is present in a chat request:

1. The query is embedded with `nomic-embed-text`.
2. The project's FAISS index is searched for the top-K nearest chunks (default 6).
3. Retrieved chunks are injected into the system prompt with their source document name.
4. The assistant is instructed to cite the document name and section when drawing on retrieved content.

RAG runs automatically — no special wiring is needed in the chat request beyond providing `retrievalQuery`.

---

## Fine-tuning

The `fine-tuning/` directory contains infrastructure for actual weight fine-tuning beyond the RAG + system-prompt behaviour:

```
fine-tuning/
  dataset.jsonl    # 35 training examples in ChatML format
  finetune.py      # Unsloth QLoRA script
```

`dataset.jsonl` covers: off-topic refusal, citation policy, statistical guidance, methodology critique, experimental design, research planning, academic writing, literature review, context-grounded answers, research ethics, and qualitative methods.

`finetune.py` trains a QLoRA adapter (rank 16, 4-bit quantisation) using [Unsloth](https://github.com/unslothai/unsloth) and exports a GGUF Q4_K_M file for use with `ollama create`. It requires a CUDA GPU.

The `ollama/Modelfile` is a production Modelfile that configures inference parameters (temperature 0.15, top_p 0.90, context 8 192 tokens) and embeds the research-only system prompt. Use it to register a fine-tuned GGUF with Ollama:

```bash
# After finetune.py exports vyrix-research.gguf
ollama create vyrix-research -f ollama/Modelfile
```

**Note:** fine-tuning is a separate offline process. The running application always uses `llama3.2:3b-instruct` via Ollama; the fine-tuned model requires a separate `ollama create` step and a change to `DEFAULT_CHAT_MODEL` (which also requires updating the Zod enum in `ai-config.ts` and `chat-schemas.ts`).

---

## Integration guide

Vyrix is built to be **embedded as a feature inside a larger Next.js monorepo**. Here is the recommended integration path.

### 1. Copy the source tree

The entire Vyrix feature lives under:

```
src/
  app/api/ai/          # Next.js API route handlers
  features/ai/         # TypeScript contracts (types shared with frontend)
  server/ai/           # Business logic, services, repositories
  lib/observability/   # Structured logger
  server/db/           # SQLite client + schema
  components/          # Demo UI (replace with your own)
```

Copy these into your monorepo. The `src/app/api/ai/` routes register automatically with Next.js App Router.

### 2. Run the SQLite migration

On first startup the app reads `src/server/db/sqlite/schema.sql` and creates all tables. Ensure this file is present in your deployment (the Dockerfile copies it explicitly).

If your host app already has a SQLite database, you can point `VYRIX_SQLITE_PATH` at it — Vyrix uses `CREATE TABLE IF NOT EXISTS` throughout.

### 3. Scope everything to `projectId`

Every resource (conversations, documents, vectors) is isolated by `projectId`. Your host application is responsible for generating and managing project IDs. Use any stable string identifier (UUID, user ID, workspace slug, etc.).

### 4. Call the API from your frontend

**Create a conversation:**
```typescript
const res = await fetch('/api/ai/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: currentUser.workspaceId,
    title: 'New session',
    scope: 'project',
    model: 'llama3.2:3b-instruct',
  }),
});
const { conversation } = await res.json();
```

**Stream a chat message:**
```typescript
const res = await fetch('/api/ai/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversationId: conversation.id,
    projectId: currentUser.workspaceId,
    model: 'llama3.2:3b-instruct',
    provider: 'ollama',
    message: userInput,
    context: { retrievalQuery: userInput, topK: 6 },
  }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === 'message.delta') appendToUI(event.delta);
  }
}
```

**Upload a document:**
```typescript
const base64 = btoa(
  String.fromCharCode(...new Uint8Array(await file.arrayBuffer()))
);

await fetch('/api/ai/documents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: currentUser.workspaceId,
    fileName: file.name,
    mimeType: file.type,
    contentBase64: base64,
  }),
});
```

### 5. Health check in your readiness probe

```
GET /api/ai/health
```

Returns `200` when Ollama is reachable and the model is available. Returns `503` otherwise. Wire this into your load balancer or Kubernetes readiness probe.

### 6. Environment variables

Add the variables from the [Configuration reference](#configuration-reference) to your deployment environment. In Docker Compose or Kubernetes, point `OLLAMA_BASE_URL` at your Ollama service name.

---

## Known limitations

- **No authentication or rate limiting** — the API is unauthenticated. Add middleware in `src/app/api/ai/` or at the edge before exposing to untrusted clients.
- **Image OCR requires network access at runtime** — `tesseract.js` downloads language data on first use. In fully airgapped environments, pre-bundle the language files or disable the OCR branch.
- **FAISS does not support partial index updates** — deleting a document triggers a full index rebuild for that project. For projects with tens of thousands of chunks this may take several seconds.
- **Single model** — the app is deliberately locked to `llama3.2:3b-instruct`. Changing the model requires updating the Zod enum in `src/server/ai/validators/chat-schemas.ts` and `src/server/ai/config/ai-config.ts`.
- **CPU inference is slow** — on a CPU-only machine expect 5–30 seconds per response depending on prompt length. Use the GPU Docker profile or run Ollama natively with GPU offload for acceptable latency.
- **No multi-tenancy isolation at the database level** — `projectId` is enforced in application code, not via row-level security. For strict multi-tenant deployments, run separate instances per tenant or add database-level isolation.
