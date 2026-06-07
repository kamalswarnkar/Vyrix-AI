# Vyrix Chatbot Debug Report

## Summary

This pass focused on restoring runtime visibility, model availability display, document persistence, prompt stability, and clearer failure handling. The backend is now behaving correctly when Ollama is unavailable, and the frontend no longer depends on slow/hanging runtime checks or dev-server WebSocket failures to remain usable.

## Root Cause Analysis

### 1. Runtime status stayed on "Checking local AI runtime..."

Root cause:

- `requestTimeoutMs` existed in `src/server/ai/config/ai-config.ts` but was never used by `OllamaClient`.
- When Ollama was unavailable, bootstrap/health requests waited on raw fetch behavior instead of failing quickly.

Why it occurred:

- `src/app/api/ai/bootstrap/route.ts` calls `AiHealthService.getStatus()`.
- `AiHealthService` calls `OllamaClient.listModels()`.
- `OllamaClient` had no timeout or provider-specific error mapping, so frontend bootstrap could stall long enough to look broken.

Fix:

- wired `requestTimeoutMs` into `OllamaClient`
- added timeout-backed fetch with `AbortController`
- returned explicit provider-unavailable messages for unreachable Ollama

### 2. Model dropdown was empty

Root cause:

- the frontend only populates model options after bootstrap succeeds
- bootstrap completion was being delayed by the slow Ollama reachability path above
- the dev server was also blocking HMR/WebSocket access from `127.0.0.1`, which caused unstable client behavior in development

Why it occurred:

- the page was being served from `127.0.0.1:3000`
- Next dev treated `127.0.0.1` as a blocked origin for `/_next/webpack-hmr`
- the browser console WebSocket failures matched the server log warning exactly

Fix:

- added `allowedDevOrigins: ["127.0.0.1", "localhost"]` in `next.config.ts`
- reduced bootstrap latency so model metadata is returned quickly even when Ollama is down

### 3. Prompt disappeared after send failure

Root cause:

- the frontend cleared `draft` before it knew the chat stream had started successfully

Why it occurred:

- `handleSendMessage()` called `setDraft("")` before verifying the streaming response
- when Ollama was unavailable, the UI lost the prompt even though no assistant response was generated

Fix:

- only clear the prompt after the stream response is confirmed valid
- restore the prompt on failure
- surface the health message directly when runtime is unavailable

### 4. Uploaded file appeared to disappear/reset

Root cause:

- the file input was always reset in `finally`, including failure paths
- the UI had no remove action or explicit persistence control for uploaded documents
- dev WebSocket instability also contributed to state resets in development

Why it occurred:

- the uploaded document list depended on successful reload from the backend
- the selected file input was cleared immediately whether the upload succeeded or not

Fix:

- keep the selected filename visible during upload
- clear the file input only after successful upload
- added document delete support so uploaded files persist until explicitly removed

### 5. Chat API returned generic errors

Root cause:

- failed Ollama calls surfaced as plain `fetch failed`

Why it occurred:

- `OllamaClient` threw generic errors for unreachable provider and missing models

Fix:

- added provider/model-specific AI errors
- chat now returns `AI_PROVIDER_UNAVAILABLE` with a clear actionable message

## Broken Components Identified

- runtime bootstrap path
- health/status reporting
- dev WebSocket/HMR configuration for `127.0.0.1`
- prompt state handling on chat failure
- upload-state handling in the frontend
- document lifecycle controls
- Ollama error classification in chat flows

## Fixes Implemented

### Backend

- added Ollama request timeouts and explicit provider/model error mapping
- connected `requestTimeoutMs` to the actual runtime client
- improved health message clarity when Ollama is missing/unreachable
- added document delete API and service/repository support

### Frontend

- stabilized bootstrap/data fetches with client-side timeouts
- preserved prompt text on failed sends
- prevented message submission when runtime is known unavailable
- reloaded documents/conversations per project
- kept selected upload filename visible during upload
- added remove action for uploaded documents
- persisted key UI state in session storage

### Development Runtime

- allowed Next dev origin access from `127.0.0.1`

## Testing Results

### Automated

- `npm test` passed
- `npm run lint` passed
- `npm run build` passed

### Endpoint Verification

- `GET /api/ai/bootstrap`
  - now returns in about `166 ms`
  - returns full model list even while Ollama is unavailable
- `GET /api/ai/health`
  - returns `503`
  - now explains that Ollama at `http://127.0.0.1:11434` is unreachable and what model to pull
- `POST /api/ai/conversations`
  - works successfully
- `POST /api/ai/documents`
  - works successfully
- `DELETE /api/ai/documents/[documentId]`
  - works successfully
- `POST /api/ai/chat`
  - now returns `AI_PROVIDER_UNAVAILABLE` with a clear message instead of generic `fetch failed`

## Remaining Issues

### External Environment Blocker

- Ollama is still not installed/running on this machine
- `ollama list` is not available and `http://127.0.0.1:11434` is unreachable
- because of that, real assistant responses still cannot complete locally until Ollama is installed and a configured model is pulled

### Non-Blocking Development Note

- the build still emits one Turbopack file-trace warning related to filesystem-based workspace context loading
- this does not block app build or API behavior
