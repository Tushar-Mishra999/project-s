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
- Node.js v18+ (for building the React frontend)
- Python 3.10+
- Ollama (local LLM server)
- A database (cloud Supabase or local PostgreSQL — see [Database Setup](#database-setup))

### Step 1 — Install and start Ollama

**Linux / Mac:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```
**Windows:** Download from https://ollama.com/download and run the installer.

Pull the required models (do this once):
```bash
ollama pull llama3            # main LLM — swap for mistral, gemma2, etc.
ollama pull nomic-embed-text  # embeddings — required, do not change
```

### Step 2 — Set up Python environment

```bash
cd fastapi_backend

# Create virtual environment
python -m venv venv

# Activate it
source venv/bin/activate    # Mac / Linux
venv\Scripts\activate       # Windows

# Install dependencies
pip install -r requirements.txt
```

### Step 3 — Build the React frontend
FastAPI serves the pre-built React app. Run once (and again after any frontend changes):
```bash
# From the project root
npm install
npm run build
```

### Step 4 — Create `.env` in the project root
```env
# Switch to FastAPI backend
BACKEND=fastapi

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
OLLAMA_EMBED_MODEL=nomic-embed-text

# Database
SUPABASE_URL=http://localhost:54321      # local PostgreSQL via PostgREST
SUPABASE_SERVICE_KEY=any-local-string   # can be anything for local dev

# OR use cloud Supabase:
# SUPABASE_URL=https://<project>.supabase.co
# SUPABASE_SERVICE_KEY=eyJ...

PORT=10000
```

### Step 5 — Run

Open **3 terminals**:

**Terminal 1 — Ollama:**
```bash
ollama serve
```

**Terminal 2 — Database** (if using local PostgreSQL):
```bash
C:\postgrest\postgrest.exe C:\postgrest\postgrest.conf   # Windows
./postgrest postgrest.conf                               # Mac / Linux
```

**Terminal 3 — FastAPI:**
```bash
# From the project root
BACKEND=fastapi ./start.sh

# OR directly (from fastapi_backend/ with venv activated)
uvicorn main:app --host 0.0.0.0 --port 10000
```

Open http://localhost:10000

**Development mode** — FastAPI auto-reloads on code changes + React hot reload:
```bash
# Terminal 3 — FastAPI with reload
cd fastapi_backend && source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 10000 --reload

# Terminal 4 — React dev server
npm run client
```
Open http://localhost:5173

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

### Option B — Local PostgreSQL + pgvector (no Docker, no cloud)

Use this when you want everything running on your machine.

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

#### Install pgvector

**Windows:**
1. Go to [github.com/pgvector/pgvector/releases](https://github.com/pgvector/pgvector/releases)
2. Download the zip matching your PostgreSQL version e.g. `pgvector-v0.8.0-pg16-windows-x86_64.zip`
3. Copy extracted files:
   - `lib\vector.dll` → `C:\Program Files\PostgreSQL\16\lib\`
   - `share\extension\vector*` → `C:\Program Files\PostgreSQL\16\share\extension\`

**Mac:**
```bash
brew install pgvector
```

**Linux:**
```bash
sudo apt install -y postgresql-16-pgvector
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

`postgres-local-setup.sql` is a single file that creates all tables, indexes, functions, roles and seeds the default users. No other SQL file needed.

Verify it worked:
```bash
psql -U postgres -d projectdb -c "\dt"
```

#### Install and configure PostgREST

PostgREST is the REST API layer that lets the app talk to PostgreSQL without code changes.

1. Go to [github.com/PostgREST/postgrest/releases](https://github.com/PostgREST/postgrest/releases)
2. Download the binary for your OS → extract

**Windows:** place `postgrest.exe` at `C:\postgrest\`

Create a config file:

**Windows** — `C:\postgrest\postgrest.conf`:
```conf
db-uri = "postgres://postgres:YOUR_PASSWORD@localhost:5432/projectdb"
db-schemas = "public"
db-anon-role = "web_anon"
server-port = 54321
```

**Mac / Linux** — `postgrest.conf` anywhere convenient:
```conf
db-uri = "postgres://postgres:YOUR_PASSWORD@localhost:5432/projectdb"
db-schemas = "public"
db-anon-role = "web_anon"
server-port = 54321
```

#### Update `.env`
```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=any-local-string
```

#### File uploads with local PostgreSQL
When `SUPABASE_URL` points to localhost, the FastAPI backend automatically saves uploaded files to `fastapi_backend/uploads/` and serves them at `http://localhost:10000/uploads/`. Nothing extra to configure.

> The Node.js backend still requires cloud Supabase Storage for file uploads — local PostgreSQL only works fully with the FastAPI backend.

#### Daily startup
PostgreSQL runs as a background service and starts automatically.
You only need to start PostgREST manually each day:

**Windows** — create `start-db.bat` in the project root:
```bat
@echo off
C:\postgrest\postgrest.exe C:\postgrest\postgrest.conf
```

**Mac / Linux:**
```bash
./postgrest postgrest.conf
```

Run this before starting the project.

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
│   ├── uploads/                  Local file storage (auto-created when using localhost DB)
│   └── lib/
│       ├── clients.py            Supabase + Neo4j clients
│       ├── llm.py                Ollama LLM + embeddings
│       ├── rag.py                Retrieval, reranking, HyDE enrichment
│       ├── extract.py            PDF / DOCX / PPTX / XLSX text extraction
│       ├── chunk.py              Document chunking
│       ├── graph.py              Neo4j graph operations (currently disabled)
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
