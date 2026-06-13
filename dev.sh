#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# dev.sh — convenience wrapper for Vyrix local development
#
# Usage:
#   ./dev.sh start        Start the full Docker stack
#   ./dev.sh stop         Stop all containers (keep data)
#   ./dev.sh restart      Restart app container only
#   ./dev.sh logs         Tail all container logs
#   ./dev.sh logs vyrix   Tail a specific container
#   ./dev.sh status       Show container health
#   ./dev.sh models       List models loaded in Ollama
#   ./dev.sh pull-models  Pull/refresh Ollama models manually
#   ./dev.sh build-model  (Re)build the tuned vyrix-research model
#   ./dev.sh reset        ⚠ Destroy all volumes and start fresh
#   ./dev.sh local        Run Next.js dev server locally (no Docker)
# ──────────────────────────────────────────────────────────────

set -euo pipefail

CMD="${1:-help}"
COMPOSE_CMD="docker compose"

require_docker() {
  if ! command -v docker &>/dev/null; then
    echo "❌  Docker is not installed or not in PATH."
    exit 1
  fi
}

case "$CMD" in
  start)
    require_docker
    echo "🚀  Starting Vyrix stack…"
    $COMPOSE_CMD up -d --build
    echo ""
    echo "✅  Stack is up. Open http://localhost:3000"
    echo "    Ollama:   http://localhost:11434"
    echo "    ChromaDB: http://localhost:8000"
    ;;

  stop)
    require_docker
    echo "🛑  Stopping Vyrix stack…"
    $COMPOSE_CMD down
    ;;

  restart)
    require_docker
    echo "🔄  Restarting vyrix-app…"
    $COMPOSE_CMD restart vyrix
    ;;

  logs)
    require_docker
    SERVICE="${2:-}"
    if [[ -n "$SERVICE" ]]; then
      $COMPOSE_CMD logs -f "$SERVICE"
    else
      $COMPOSE_CMD logs -f
    fi
    ;;

  status)
    require_docker
    $COMPOSE_CMD ps
    ;;

  models)
    require_docker
    echo "📦  Models in Ollama:"
    curl -s http://localhost:11434/api/tags | python3 -c "
import json, sys
data = json.load(sys.stdin)
models = data.get('models', [])
if not models:
    print('  (none)')
else:
    for m in models:
        size = m.get('size', 0)
        print(f\"  {m['name']}  ({round(size/1024/1024/1024, 1)} GB)\")
"
    ;;

  pull-models)
    require_docker
    EMBED="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"
    echo "⬇️   Pulling $EMBED…"
    docker exec vyrix-ollama ollama pull "$EMBED"
    ;;

  build-model)
    require_docker
    CHAT="${DEFAULT_CHAT_MODEL:-vyrix-research}"
    echo "🔨  Building tuned model: $CHAT"
    # Copy Modelfile into running container then create
    docker cp ollama/Modelfile vyrix-ollama:/tmp/Modelfile
    docker exec vyrix-ollama ollama create "$CHAT" -f /tmp/Modelfile
    echo "✅  Model $CHAT is ready."
    ;;

  reset)
    require_docker
    echo "⚠️   This will DELETE all volumes (database, uploads, Ollama models)."
    read -r -p "Type YES to confirm: " CONFIRM
    if [[ "$CONFIRM" == "YES" ]]; then
      $COMPOSE_CMD down -v
      echo "🗑️   Volumes removed. Run './dev.sh start' to rebuild."
    else
      echo "Aborted."
    fi
    ;;

  local)
    echo "🖥️   Starting local Next.js dev server…"
    if [[ ! -f ".env.local" ]]; then
      echo "ℹ️   No .env.local found. Copying from .env.example…"
      cp .env.example .env.local
    fi
    npm run dev
    ;;

  help|*)
    grep '^#   ' "$0" | sed 's/^#   //'
    ;;
esac
