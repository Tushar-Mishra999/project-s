#!/usr/bin/env bash
# Switch between Node.js (Vertex AI / Gemini) and FastAPI (Ollama) backends.
# Set BACKEND=fastapi to use Python; defaults to Node.js.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ "$BACKEND" = "fastapi" ]; then
  echo ">>> Starting FastAPI + Ollama backend (port ${PORT:-10000})"
  cd "$ROOT/fastapi_backend"
  exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-10000}"
else
  echo ">>> Starting Node.js + Vertex AI backend (port ${PORT:-10000})"
  exec node "$ROOT/server.js"
fi
