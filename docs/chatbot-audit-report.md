# Vyrix Chatbot Audit Report

## Scope

This audit reviews Vyrix as a chatbot application based on the current codebase in `src/app/api/ai`, `src/server/ai`, `src/server/db`, and related docs. The goal is to distinguish implemented functionality from planned architecture, identify gaps and risks, and document the highest-impact improvements made during this pass.

## Executive Summary

Before this implementation pass, Vyrix already had a meaningful chatbot backend foundation:

- local Ollama-based chat completion and token streaming routes
- SQLite-backed conversation and message persistence
- health checks for local model runtime availability
- document upload, text extraction, chunking, and keyword retrieval
- workspace context collection for project-aware prompting

However, it was not yet a usable chatbot product for demonstration purposes:

- there was no frontend or app shell for end users
- error handling was inconsistent, with many validation and runtime failures surfacing as generic `500` responses
- document upload storage had a path traversal risk through unsanitized `projectId`
- SQLite startup assumed the database directory already existed
- there was no single bootstrap endpoint for frontend readiness, models, and runtime status

This pass closes those highest-impact gaps by adding a lightweight demo frontend, improving backend reliability and error reporting, and fixing the most important storage/security issue.

## Current Features Present In The Backend

### Chat Features

- `POST /api/ai/chat` for non-streaming chat completions
- `POST /api/ai/chat/stream` for SSE token streaming
- persistent conversations and messages in SQLite
- project/workspace-scoped conversation creation
- recent-history prompt assembly
- local model selection using configured Ollama models

### Context And Retrieval Features

- workspace file context collection from the repository
- document upload using base64 payloads
- text extraction for `txt`, `md`, `html`
- PDF extraction using `pdf-parse` with a printable-text fallback
- OCR for PNG/JPEG using `tesseract.js`
- chunk persistence and simple keyword retrieval for uploaded content
- retrieved chunk summaries injected into chat context

### Operations Features

- health endpoint for Ollama reachability and installed-model checks
- model registry with recommended use cases and fallbacks
- structured logging for chat completion and stream lifecycle events

## Architecture Assessment

### Strengths

- The code has clean separation between API routes, services, adapters, repositories, and shared contracts.
- `src/server/ai/container.ts` is a strong central composition seam.
- Shared request validation with Zod reduces contract drift.
- SQLite is correctly treated as the local source of truth for offline-first AI state.
- The system prompt is product-aware and includes anti-hallucination guidance about workspace and document context.

### Architectural Limitations

- There is still no real provider abstraction beyond Ollama in practice, even though the structure hints at one.
- Retrieval is SQLite keyword scoring only; embeddings/vector search remain planned, not implemented.
- Chat history is capped by message count, not token budget, so prompt size can still grow unpredictably.
- Conversation metadata does not yet support rename, delete, archive, or summarization flows.
- Uploaded-document parsing, chunking, and retrieval happen in-process and synchronously, which will not scale to heavier workloads.

## Capability Assessment

### What The App Can Do Now

- create conversations
- persist and reload message history
- send prompts to a local model
- stream assistant tokens back to the client
- upload research files and extract usable text from several formats
- retrieve simple supporting chunks for project-aware prompts
- expose AI runtime health for troubleshooting

### What A Real Chatbot Product Still Lacks

- authenticated multi-user isolation
- conversation rename/delete/search
- assistant retry/regenerate/edit flows
- cancellation for streaming responses
- grounded citations rendered in the chat UI
- retrieval diagnostics surfaced to the user
- background ingestion jobs for large files
- embeddings/vector retrieval and relevance tuning
- rate limiting and abuse controls
- observability beyond console logs

## Bugs And Product Gaps Found

### High Impact

- No end-user frontend existed, so the project was not demonstrable as a chatbot application.
- Upload storage used `projectId` directly in filesystem path construction, which allowed path traversal outside the intended upload directory.
- SQLite initialization did not ensure that the database directory existed before opening the file.
- Several API routes converted user input and validation problems into generic server errors instead of clear client errors.
- The streaming route lacked the same structured error mapping as the non-streaming route.

### Medium Impact

- `docx` is recognized as a document kind but is not actually supported by the upload validator/parser path.
- Retrieval is keyword-only, so answers grounded in uploaded content will degrade quickly on paraphrased queries.
- Conversation listing exists only by `projectId`; workspace-scoped listing is missing.
- The app has only minimal automated test coverage.

### Lower Impact

- The README does not explain how to run or demonstrate the chatbot.
- There is no product-level onboarding flow for "Ollama not installed" or "model missing" beyond raw API output.

## Security Review

### Confirmed Concerns

- Filesystem path traversal risk in upload storage path construction.
- No authentication or authorization on AI endpoints.
- No rate limiting on chat, retrieval, or uploads.
- Large base64 uploads can still create memory pressure because upload handling is request-buffer based.

### Lower-Risk Observations

- Workspace context collection correctly prevents escaping the workspace root.
- SQL usage is parameterized through `better-sqlite3` prepared statements, which is good.

## Scalability Review

### Current Constraints

- synchronous local parsing and OCR will block request handling for larger files
- keyword retrieval over SQLite rows will not scale to larger corpora
- message-history truncation is message-count based rather than token-budget based
- SQLite is a good local-first default, but write-heavy chat plus document ingestion will eventually need more careful concurrency handling
- SSE streaming is appropriate for the demo, but there is no queueing, cancellation, or backpressure management

### Likely Next Bottlenecks

- OCR latency for images
- PDF parsing time and memory use
- growing message history
- retrieval quality for larger document sets
- full-file workspace context loading for many code files

## Highest-Impact Improvements Implemented In This Pass

- Added a lightweight but functional frontend demo for the chatbot.
- Added a frontend bootstrap API for model/runtime readiness.
- Improved route-level error handling and validation responses.
- Fixed unsafe upload path handling.
- Made SQLite startup more reliable by ensuring parent directories exist.

### Files Added Or Changed

- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- `src/components/chatbot-demo.tsx`
- `src/app/api/ai/bootstrap/route.ts`
- `src/server/ai/http/route-error.ts`
- updated AI route handlers for better validation and runtime error mapping
- updated SQLite startup and document storage handling
- updated `README.md`

### What The New Demo Frontend Covers

- checks runtime readiness through a single bootstrap call
- lets users create a chat implicitly on first message
- streams assistant output from the live SSE route
- lists and reloads saved conversations
- uploads small files into the existing document pipeline
- exposes workspace-context and model controls without adding frontend complexity

### Residual Issues After This Pass

- the build still reports one Turbopack file-trace warning around filesystem-based workspace context loading, but the app compiles and builds successfully
- retrieval quality is still intentionally basic because embeddings/vector indexing are not implemented yet
- there is still no auth, rate limiting, or background job pipeline

## Recommendations

### Next Product Steps

1. Add retrieval-backed chat citations to the UI and response contract.
2. Add embeddings/vector retrieval before positioning the app as a research-grade assistant.
3. Add conversation rename/delete and retry/regenerate flows.
4. Add upload job status and background ingestion for large documents.
5. Add token-budget-aware history trimming.

### Next Reliability/Security Steps

1. Add auth and per-user/project access rules.
2. Add upload size enforcement at transport level, not only schema level.
3. Add request throttling for chat and upload endpoints.
4. Add integration tests for chat stream, uploads, and bootstrap health flows.
5. Persist structured failure events for failed chat attempts.
