# Workspace and Upload Context

Vyrix should answer as a local research assistant with awareness of the active workspace and user-provided research material. The assistant should not rely only on chat history. It needs a context layer that can gather, parse, retrieve, and cite local sources before calling the local Ollama model.

## Target Capability

- Read selected workspace files and folders for project context.
- Accept uploaded PDFs, PNGs, and JPEGs as research sources.
- Extract text from PDFs and OCR or describe image content before the chat model sees it.
- Chunk long documents, embed chunks, and retrieve the most relevant excerpts per question.
- Inject only relevant context into the model prompt so local models do not overflow their context window.
- Cite document names, file paths, page ranges, chunk ids, and workspace excerpts when answering.

## Backend Shape

```text
UI upload/workspace picker
  -> document storage
  -> parser pipeline
  -> chunker
  -> embedding job
  -> vector index
  -> retrieval service
  -> ChatService context injection
  -> Ollama local model
```

## Source Types

| Source | Required processing | Chat input |
| --- | --- | --- |
| Workspace text/code | Path allowlist, excerpting, summarization | File path, language, summary, excerpt |
| PDF | PDF text extraction, page mapping, optional image extraction | Document id, page range, chunk ids, text excerpts |
| PNG/JPEG | OCR and/or local vision description | Image id, extracted text, visual summary |
| Markdown/TXT/HTML | Text extraction and chunking | Section title, chunk ids, excerpts |

## Current Foundation

- Chat requests can carry `context.workspaceRefs` and `context.attachmentRefs`.
- The chat service injects workspace and upload context into a research-assistant system prompt.
- Document contracts now include PDF, PNG, and JPEG source kinds.
- SQLite already has tables for documents, chunks, embedding jobs, vector index metadata, and generated research artifacts.

## Remaining Work

1. Add a workspace scanner service that reads only allowed project paths, skips ignored/build folders, and creates bounded excerpts.
2. Add upload APIs for PDF, PNG, and JPEG files.
3. Add parsers:
   - PDF text extraction with page numbers.
   - Image OCR for text-heavy screenshots and figures.
   - Optional local vision-model captioning for visual figures.
4. Add chunking and embeddings.
5. Add retrieval orchestration that fills `context.workspaceRefs` and `context.attachmentRefs` automatically before chat.
6. Add tests for parser failures, oversized files, unsupported mime types, retrieval ranking, and citation output.

## Safety Rules

- Never claim a PDF or image was read unless extracted text, OCR text, or a generated visual summary is present.
- Keep workspace access local and scoped to user-selected folders or project roots.
- Do not send workspace content to cloud services in the local-first mode.
- Prefer citations over broad claims when answering from uploaded research material.
