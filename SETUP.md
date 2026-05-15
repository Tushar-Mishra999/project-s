# Setup & Run Guide

This project supports two backends. Switch between them using the `BACKEND` environment variable.

| Backend | LLM | Use when |
|---|---|---|
| **Node.js** (default) | Vertex AI / Gemini | Cloud deployment, Render, production |
| **FastAPI** | Ollama (local) | Local development, no cloud API keys |

---

## Database Options

| Option | Docker needed | Setup effort |
|---|---|---|
| **Cloud Supabase** (recommended) | No | 5 min — sign up and paste SQL |
| **Native PostgreSQL + pgvector** | No | ~30 min — install locally |
| Local Supabase via CLI | Yes | Medium |

---

## Option 1 — Node.js Backend (default)

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure `.env`

```env
# LLM (Vertex AI / Gemini)
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Supabase (cloud or local — see Database Setup below)
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

```env
# Switch to FastAPI
BACKEND=fastapi

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
OLLAMA_EMBED_MODEL=nomic-embed-text

# Database (cloud Supabase or local PostgreSQL — see Database Setup below)
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

## Database Setup

### A — Cloud Supabase (easiest, no local install)

1. Go to [supabase.com](https://supabase.com) → create a free account → New Project
2. Go to **SQL Editor** → paste the contents of `supabase-setup.sql` → Run
3. Go to **Storage** → New bucket → name it `documents` → enable Public → Create
4. Go to **Settings → API** → copy **Project URL** and **service_role** key

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

---

### B — Native PostgreSQL + pgvector (no Docker, Windows)

Use this if you want a fully local database without Docker.

#### Step 1 — Install PostgreSQL

1. Download the installer from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
2. Run it — install all components, set a password for the `postgres` user, keep port `5432`
3. Add PostgreSQL to your PATH:
   - Search **"Environment Variables"** in Start menu → Edit the system environment variables
   - Under **System variables** → find `Path` → Edit → New → add:
     ```
     C:\Program Files\PostgreSQL\16\bin
     ```
   - Click OK on all dialogs, then open a **new** terminal
4. Verify:
   ```bash
   psql --version
   ```

#### Step 2 — Install pgvector

1. Go to [github.com/pgvector/pgvector/releases](https://github.com/pgvector/pgvector/releases)
2. Download the zip matching your PostgreSQL version — filename must contain **`x86_64`** (not `i386`):
   ```
   pgvector-v0.8.0-pg16-windows-x86_64.zip   ← correct for 64-bit PostgreSQL 16
   ```
3. Extract and copy files:
   - `lib\vector.dll` → `C:\Program Files\PostgreSQL\16\lib\`
   - `share\extension\vector*` (all files) → `C:\Program Files\PostgreSQL\16\share\extension\`

#### Step 3 — Create the database and run the schema

```bash
psql -U postgres -c "CREATE DATABASE projectdb;"
psql -U postgres -d projectdb -f "C:\path\to\project-s\postgres-local-setup.sql"
```

This single file creates all tables, indexes, functions, roles and seeds users.

Verify:
```bash
psql -U postgres -d projectdb -c "\dt"
```

#### Step 4 — Install PostgREST (standalone binary, no Docker)

PostgREST is the REST API layer the Supabase client talks to.

1. Go to [github.com/PostgREST/postgrest/releases](https://github.com/PostgREST/postgrest/releases)
2. Download `postgrest-v12.x.x-windows-x64.zip` → extract → place `postgrest.exe` at `C:\postgrest\`

Create `C:\postgrest\postgrest.conf`:
```conf
db-uri = "postgres://postgres:YOUR_PASSWORD@localhost:5432/projectdb"
db-schemas = "public"
db-anon-role = "web_anon"
server-port = 54321
```

Start PostgREST:
```bash
C:\postgrest\postgrest.exe C:\postgrest\postgrest.conf
```

#### Step 5 — Update `.env`

```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=any-local-dev-string
```

#### File storage with local PostgreSQL

When `SUPABASE_URL` points to `localhost`, the FastAPI backend **automatically** saves uploaded files to `fastapi_backend/uploads/` and serves them at `http://localhost:10000/uploads/`. No extra config needed — it detects this automatically.

> Note: This only applies to the **FastAPI** backend. The Node.js backend still requires cloud Supabase Storage for file uploads.

#### Daily startup

PostgreSQL starts automatically as a Windows service.
PostgREST must be started manually — create a `start-db.bat` in your project root:

```bat
@echo off
echo Starting PostgREST...
C:\postgrest\postgrest.exe C:\postgrest\postgrest.conf
```

Run `start-db.bat` before starting the project each day.

---

### B — Native PostgreSQL + pgvector (Mac / Linux)

**Mac:**
```bash
brew install postgresql@16 pgvector
brew services start postgresql@16
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install -y postgresql postgresql-16-pgvector
sudo systemctl start postgresql
```

Then create the database and run the schema:
```bash
psql -U postgres -c "CREATE DATABASE projectdb;"
psql -U postgres -d projectdb -f postgres-local-setup.sql
```

Download and run PostgREST binary from [github.com/PostgREST/postgrest/releases](https://github.com/PostgREST/postgrest/releases):

```bash
# Create config
cat > postgrest.conf <<EOF
db-uri = "postgres://postgres:YOUR_PASSWORD@localhost:5432/projectdb"
db-schemas = "public"
db-anon-role = "web_anon"
server-port = 54321
EOF

# Run
./postgrest postgrest.conf
```

Update `.env`:
```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=a-secret-key-at-least-32-characters-long
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
│   ├── uploads/                  Local file storage (auto-created, localhost only)
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
