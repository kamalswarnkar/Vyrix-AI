# Vyrix AI — Feature Status Summary

> **Updated:** vector layer + Docker infrastructure are now complete.

---

## ✅ What is fully implemented

### Local Chat (Ollama)
- `OllamaClient` — chat, stream-chat, list-models, and embed endpoints
- `ChatService` — system-prompt injection, conversation history windowing, context enrichment
- `AiHealthService` — health-check endpoint to surface Ollama availability in the UI

### Document Ingestion Pipeline
- `DocumentService` — upload → detect kind → extract text (PDF/image/text) → chunk → index
- Chunking: character-based with configurable size (4 000 chars) and overlap (400 chars)
- Text extraction: pdf-parse for PDFs, Tesseract.js OCR for images, raw UTF-8 for text/MD/HTML
- Deduplication: per-project SHA-256 hash index prevents re-uploading identical files

### Vector Layer (sqlite-faiss)
- `EmbeddingService` — batches chunks through `POST /api/embeddings` (Ollama, nomic-embed-text)
- `SqliteVectorRepository` — persists `vector_json` blobs in `vector_indexes` table
- In-process cosine similarity search — no external dependency at query time
- `RetrievalService` — tries vector similarity first; graceful keyword fallback when vectors are absent
- SQLite migration — adds `vector_json` column and recreates `vector_indexes` for older databases without a manual reset

### Configuration & DI
- `ai-config.ts` — Zod-validated env-driven config with sensible defaults
- `container.ts` — single-instance DI factory wiring all repositories and services together

### Docker Infrastructure
- `docker-compose.yml` — four-service stack:
  - **ollama** — LLM + embedding server (CPU); **ollama-gpu** profile for NVIDIA
  - **ollama-init** — one-shot model-pull container (creates `vyrix-research` from Modelfile, pulls `nomic-embed-text`)
  - **chromadb** — hosted vector DB (wired, ready to switch from sqlite-faiss)
  - **vyrix** — Next.js app with health-check, named volume mounts for SQLite and uploads
- `ollama/Modelfile` — tuned Llama 3.1:8b-instruct model for PhD/research use cases
- `.env.example` — documented template covering all runtime variables
- `dev.sh` — convenience CLI: `start`, `stop`, `logs`, `models`, `build-model`, `reset`, `local`

---

## ⚠️ What is wired but not yet exposed in the UI

| Feature | Status |
|---|---|
| Chat route (`/api/ai/chat`) | ✅ server-side ready |
| Document upload route (`/api/ai/documents`) | ✅ server-side ready |
| Retrieval route (`/api/ai/retrieve`) | ✅ server-side ready |
| Health route (`/api/ai/health`) | ✅ live |
| Chat UI connected to routes | ⬜ not yet |
| Document upload UI | ⬜ not yet |
| Retrieval results displayed in chat | ⬜ not yet |
| Roadmap generation engine | ⬜ planned |
| Critical analysis engine | ⬜ planned |

---

## 🚀 Quick-start (Docker)

```bash
# 1. Clone and enter the repo
git clone <repo-url> && cd Vyrix-AI-main

# 2. Copy env template
cp .env.example .env.local

# 3. Start the full stack (Ollama + ChromaDB + Next.js)
./dev.sh start

# 4. Open the app
open http://localhost:3000
```

First boot pulls `nomic-embed-text` and builds the `vyrix-research` model —
this takes a few minutes and requires ~5 GB disk space.

---

## 🖥️ Quick-start (local dev without Docker)

```bash
# Requires Ollama running locally: https://ollama.com
ollama pull nomic-embed-text
ollama create vyrix-research -f ollama/Modelfile

cp .env.example .env.local   # edit OLLAMA_BASE_URL if needed
npm install
npm run dev
```
