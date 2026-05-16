# Setup & Run Guide

This project has two backends you can switch between using one environment variable.

| Backend | LLM | Best for |
|---|---|---|
| **Node.js** (default) | Vertex AI / Gemini | Production, cloud deployment |
| **FastAPI** | Ollama (runs locally) | Local development, no cloud API keys needed |

Both backends expose the same API and serve the same React frontend.

---

## Quick Start — Which path should I take?

- **I have Google Cloud / Vertex AI credentials** → [Run with Node.js](#running-with-nodejs-backend)
- **I want to run everything locally with no cloud keys** → [Run with FastAPI](#running-with-fastapi-backend)
- **I need to set up the database first** → [Database Setup](#database-setup)

---

## Running with Node.js Backend

### Prerequisites
- Node.js v18+
- A database (cloud Supabase or local PostgreSQL — see [Database Setup](#database-setup))
- Google Cloud credentials (Vertex AI / Gemini)

### Step 1 — Install dependencies
```bash
npm run install:all
```

### Step 2 — Create `.env` in the project root
```env
# Backend selector (node is default, can omit this line)
BACKEND=node

# Google Cloud / Vertex AI
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Database
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

PORT=10000
```

### Step 3 — Run

**Development** — backend + React dev server, both with hot reload:
```bash
npm run start
```
Open http://localhost:5173

**Production** — builds React and serves everything from Node.js:
```bash
npm run build       # once, or after frontend changes
npm run production
```
Open http://localhost:10000

---

## Running with FastAPI Backend

### Prerequisites
- Node.js v18+ (for the React dev server)
- Python 3.13 (recommended) or 3.10+
- PostgreSQL 14+ running locally
- Ollama (local LLM server)

> **No PostgREST, no pgvector, no Supabase account needed.**
> The FastAPI backend connects directly to PostgreSQL via psycopg2 and uses ChromaDB (bundled, file-based) for vector search.

### Step 1 — Install and start Ollama

**Windows:** Download from https://ollama.com/download and run the installer.

**Linux / Mac:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Pull the required models (do this once — downloads ~4 GB total):
```bash
ollama pull llama3            # main LLM
ollama pull nomic-embed-text  # embeddings — required, do not change
```

Ollama runs as a background service automatically after install. You can verify it is running at http://localhost:11434.

### Step 2 — Set up PostgreSQL

See [Database Setup — Local PostgreSQL](#option-b--local-postgresql-no-docker-no-cloud) below.

### Step 3 — Set up Python environment

```bash
cd fastapi_backend

# Create virtual environment
python -m venv venv

# Activate it
source venv/bin/activate    # Mac / Linux
venv\Scripts\activate       # Windows

# Install dependencies (--prefer-binary avoids compiling C/Rust extensions)
pip install -r requirements.txt --prefer-binary
```

### Step 4 — Create `.env` inside `fastapi_backend/`

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=projectdb
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Optional — defaults to fastapi_backend/chroma_data/
# CHROMA_DIR=C:\path\to\chroma_data
```

### Step 5 — Run

Open **2 terminals**:

**Terminal 1 — FastAPI backend:**
```bash
cd fastapi_backend
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac / Linux
uvicorn main:app --host 0.0.0.0 --port 10000
```

You should see `Application startup complete.` — the backend is ready.

**Terminal 2 — React dev server:**
```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173

**Production mode** — serves the pre-built frontend from FastAPI directly:
```bash
# Build the frontend once (or after any frontend changes)
cd client && npm install && npm run build

# Then start FastAPI — it serves the built files at /
cd fastapi_backend
uvicorn main:app --host 0.0.0.0 --port 10000
```

Open http://localhost:10000

---

## Switching Between Backends

Edit `BACKEND` in `.env` and restart:

```env
BACKEND=node      # Node.js + Vertex AI  (this is the default if BACKEND is not set)
BACKEND=fastapi   # FastAPI + Ollama
```

Or switch inline without editing `.env`:
```bash
./start.sh                    # Node.js (default)
BACKEND=fastapi ./start.sh    # FastAPI
```

---

## Database Setup

### Option A — Cloud Supabase (recommended, no local install)

1. Sign up at [supabase.com](https://supabase.com) → New Project
2. **SQL Editor** → paste contents of `supabase-setup.sql` → Run
3. **Storage** → New bucket → name: `documents` → enable Public → Create
4. **Settings → API** → copy Project URL and service_role key

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

---

### Option B — Local PostgreSQL (no Docker, no cloud)

Use this when you want everything running on your machine.
Vector search is handled by ChromaDB — **pgvector is not required**.

#### Install PostgreSQL

**Windows:**
1. Download from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
2. Run the installer — set a password for `postgres`, keep port `5432`
3. Add to PATH: Search **Environment Variables** → System variables → `Path` → Edit → New → add `C:\Program Files\PostgreSQL\16\bin` → OK
4. Open a **new** terminal and verify: `psql --version`

**Mac:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Linux:**
```bash
sudo apt install -y postgresql
sudo systemctl start postgresql
```

#### Create database and run schema

```bash
# Windows
psql -U postgres -c "CREATE DATABASE projectdb;"
psql -U postgres -d projectdb -f "C:\path\to\project-s\postgres-local-setup.sql"

# Mac / Linux
psql -U postgres -c "CREATE DATABASE projectdb;"
psql -U postgres -d projectdb -f postgres-local-setup.sql
```

`postgres-local-setup.sql` creates all tables, indexes, functions, and seeds the default users in one shot. No other SQL file needed.

Verify it worked (should list ~13 tables):
```bash
psql -U postgres -d projectdb -c "\dt"
```

#### File uploads
The FastAPI backend saves uploaded files to `fastapi_backend/uploads/` automatically and serves them at `http://localhost:10000/uploads/`. Nothing extra to configure.

#### Daily startup
PostgreSQL runs as a background service and starts automatically on boot. No other database process needs to be started manually.

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
├── start.sh                      Backend switcher (reads BACKEND env var)
├── lib/                          Node.js shared modules
│   ├── clients.js
│   ├── feed.js
│   ├── extract.js
│   ├── chunk.js
│   ├── rag.js
│   └── graphExtract.js
├── fastapi_backend/              Python FastAPI backend
│   ├── main.py                   All API routes
│   ├── requirements.txt          Python dependencies
│   ├── uploads/                  Local file storage (auto-created on first upload)
│   ├── chroma_data/              ChromaDB vector store (auto-created on first ingest)
│   └── lib/
│       ├── db.py                 psycopg2 helpers (fetch_all, fetch_one, execute)
│       ├── clients.py            ChromaDB client + config loader
│       ├── llm.py                Ollama LLM + embeddings
│       ├── rag.py                Retrieval, reranking, HyDE enrichment
│       ├── extract.py            PDF / DOCX / PPTX / XLSX text extraction
│       ├── chunk.py              Document chunking
│       ├── render.py             PDF / DOCX / XLSX export rendering
│       ├── action_items.py       Action item extraction
│       └── feed.py               RSS feed pipeline + live search
├── config.json                   Sources, parts, models, RAG params
├── supabase-setup.sql            Schema for cloud Supabase
├── postgres-local-setup.sql      Schema for local PostgreSQL (standalone)
├── DOCUMENTATION.md              Full feature documentation
├── .env                          API keys (gitignored)
└── client/                       React frontend (Vite)
    └── src/
        └── tabs/
```
