# Vyrix

Vyrix is a local-first chatbot and research-assistant prototype built with Next.js, SQLite, and Ollama.

## What is in this repo

- streaming and non-streaming chat APIs
- SQLite-backed conversations and messages
- Ollama health checks and model registry
- document upload, text extraction, chunking, and simple retrieval
- workspace-context collection for project-aware prompts
- a temporary lightweight frontend for demonstrating the chatbot

## Run locally

1. Install dependencies:

```powershell
npm install
```

2. Start Ollama and make sure at least one configured model is installed.

3. Start the app:

```powershell
npm run dev
```

4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Demo flow

- Use the homepage to inspect runtime status.
- Pick a model and send a research-style prompt.
- Upload a small `txt`, `md`, `html`, `pdf`, `png`, or `jpeg` file to test retrieval context.
- Toggle workspace context on when you want the assistant to inspect repo files.

## Important current limitations

- Ollama must be installed and running locally.
- Retrieval is still keyword-based, not embedding/vector based yet.
- The current frontend is intentionally temporary and lightweight.
- There is no auth or rate limiting yet.

## Audit and implementation notes

See [docs/chatbot-audit-report.md](/C:/Users/swarn/OneDrive/Documents/Vyrix/docs/chatbot-audit-report.md) for the full chatbot audit, implemented fixes, and follow-up recommendations.
