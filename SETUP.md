# Setup & Run Guide

This project supports two backends. You can switch between them using the `BACKEND` environment variable.

| Backend | LLM | Use when |
|---|---|---|
| **Node.js** (default) | Vertex AI / Gemini | Cloud deployment, Render, production |
| **FastAPI** | Ollama (local) | Local development, no cloud API keys |

---

## Prerequisites

### Common
- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **Supabase** project (cloud) **or** local Supabase (see [Local Supabase](#local-supabase))

### FastAPI backend only
- **Python** 3.10+
- **Docker** (required for local Supabase)
- **Ollama** — local LLM server

---

## Option 1 — Node.js Backend (default)

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure `.env`

Create a `.env` file in the project root:

```env
# LLM (Vertex AI / Gemini)
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Optional
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
PORT=10000
```

### 3. Run

**Development** (backend + React dev server with hot reload):
```bash
npm run start
```

**Production** (serves built React from Node.js):
```bash
npm run build
npm run production
```

- App: http://localhost:10000
- React dev server (dev only): http://localhost:5173

---

## Option 2 — FastAPI Backend (Ollama)

### 1. Install Ollama

```bash
# Linux / Mac
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com/download
```

Pull the required models:

```bash
ollama pull llama3              # or any model you prefer e.g. mistral, gemma2
ollama pull nomic-embed-text    # required — must produce 768-dim embeddings
```

### 2. Set up Python virtual environment

```bash
cd fastapi_backend

python -m venv venv

# Activate
source venv/bin/activate        # Linux / Mac
venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure `.env`

Add these to your `.env` in the project root:

```env
# Switch to FastAPI
BACKEND=fastapi

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
OLLAMA_EMBED_MODEL=nomic-embed-text

# Supabase (same as Node.js or use local — see below)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Optional
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
PORT=10000
```

### 4. Build the React frontend

FastAPI serves the pre-built React app — run this once (and after any frontend changes):

```bash
# From project root
npm install
npm run build
```

### 5. Run

**Terminal 1 — Ollama:**
```bash
ollama serve
```

**Terminal 2 — FastAPI:**
```bash
# From project root
BACKEND=fastapi ./start.sh

# OR directly
cd fastapi_backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 10000
```

Open http://localhost:10000

**Development mode** (hot reload on both backend and frontend):

```bash
# Terminal 1
ollama serve

# Terminal 2 — FastAPI with auto-reload
cd fastapi_backend && source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 10000 --reload

# Terminal 3 — React dev server (hot reload, proxies /api → :10000)
npm run client
```

Open http://localhost:5173

---

## Switching Between Backends

Change `BACKEND` in `.env` and restart:

```env
BACKEND=node      # Node.js + Vertex AI  (default if unset)
BACKEND=fastapi   # FastAPI + Ollama
```

Or set it inline without editing `.env`:

```bash
./start.sh                    # Node.js (default)
BACKEND=fastapi ./start.sh    # FastAPI
BACKEND=node ./start.sh       # Node.js
```

Both backends run on the **same port** — only one runs at a time.

---

## One-time Supabase Schema Setup

Run `supabase-setup.sql` once to create all tables, indexes, and RPC functions.

**Cloud Supabase:**
1. Open your Supabase project → SQL Editor
2. Paste the contents of `supabase-setup.sql` and run

**Local Supabase:**
```bash
cp supabase-setup.sql supabase/migrations/20240101000000_initial_schema.sql
supabase db reset
```

Then create a **public** Storage bucket named `documents`:
- Cloud: Supabase dashboard → Storage → New bucket → `documents` → Public
- Local: `supabase storage create documents --public`

---

## Local Supabase

Run a full Supabase stack on your machine (no cloud account needed).

### Install Docker

```bash
# Mac
brew install --cask docker
open /Applications/Docker.app

# Linux (Ubuntu/Debian)
sudo apt update && sudo apt install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER && sudo systemctl enable --now docker

# Windows — download Docker Desktop from https://docs.docker.com/desktop/install/windows-install/
```

### Install Supabase CLI and start

```bash
npm install -g supabase

# In project root
supabase init
supabase start
```

After startup it prints your local credentials:

```
API URL:          http://localhost:54321
Studio URL:       http://localhost:54323
service_role key: eyJ...   ← use this as SUPABASE_SERVICE_KEY
```

Update `.env`:

```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=<service_role key from above>
```

Apply schema and create bucket:

```bash
cp supabase-setup.sql supabase/migrations/20240101000000_initial_schema.sql
supabase db reset
supabase storage create documents --public
```

Daily commands:

```bash
supabase start    # start local stack
supabase stop     # stop when done
supabase status   # view URLs and keys
```

---

## Deploy on Render (Node.js backend)

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run production`
- Add all `.env` keys as Environment Variables in the Render dashboard
- Add `NODE_ENV=production`

---

## Project Layout

```
.
├── server.js                     Node.js + Express backend
├── start.sh                      Backend switcher script (BACKEND env var)
├── lib/                          Node.js shared modules
│   ├── clients.js
│   ├── feed.js
│   ├── extract.js
│   ├── chunk.js
│   ├── rag.js
│   └── graphExtract.js
├── fastapi_backend/              Python FastAPI backend
│   ├── main.py                   FastAPI app (all routes)
│   ├── requirements.txt
│   └── lib/
│       ├── clients.py            Supabase + Neo4j clients
│       ├── llm.py                Ollama LLM + embeddings
│       ├── rag.py                Retrieval, reranking, HyDE
│       ├── extract.py            PDF/DOCX/PPTX/XLSX extraction
│       ├── chunk.py              Document chunking
│       ├── graph.py              Neo4j graph operations
│       ├── render.py             PDF/DOCX/XLSX rendering
│       ├── action_items.py       Action item extraction
│       └── feed.py               RSS feed pipeline
├── config.json                   Sources, parts, models, RAG params
├── supabase-setup.sql            Database schema + RPC
├── DOCUMENTATION.md              Full feature documentation
├── .env                          API keys (gitignored)
└── client/                       React frontend (Vite)
    └── src/
        └── tabs/
```
