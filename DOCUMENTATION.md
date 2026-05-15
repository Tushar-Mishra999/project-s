# Kernel — Full Project Documentation

> Intended audience: a new engineering team rebuilding this system from scratch. Covers every user flow, data model, API contract, AI pipeline, and access control rule.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Knowledge Hub](#2-knowledge-hub) *(primary feature — most detail)*
3. [Feed](#3-feed)
4. [Home Page](#4-home-page)
5. [Utilities](#5-utilities)

---

## 1. Project Overview

**Kernel** is an AI-powered knowledge management and intelligence platform for a multi-part organisation. It lets teams upload internal documents, converse with them through a RAG chatbot, generate structured reports, receive curated tech-news feeds, record and parse meetings, manage tasks, and coordinate cross-functional workgroups — all scoped by the user's role and organisational part.

### 1.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 22, Express 5 (ESM) |
| Frontend | React 18, Vite, plain CSS (dark design system) |
| Primary database | Supabase (PostgreSQL 15 + pgvector extension) |
| Vector index | HNSW cosine, `vector(768)` |
| Graph database | Neo4j Aura (cloud-managed) |
| LLM — primary | Gemini 2.5 Flash via `@google/genai` Vertex AI SDK |
| LLM — alternates | Gemma 4 26B / GLM-5 / GPT-OSS 20B via Vertex AI MaaS (OpenAI-compat endpoint) |
| Embeddings | Google `text-embedding-004` via Vertex AI REST API (768 dims) |
| File storage | Supabase Storage (public bucket `documents`) |
| PDF rendering | Puppeteer (headless Chromium) |
| DOCX rendering | html-to-docx |
| XLSX rendering | SheetJS (xlsx) |
| Speech-to-text | OpenAI Whisper (local, via `whisper` npm package) |
| Email | Gmail API v1 via `googleapis` SDK (OAuth 2.0) |
| Deployment | Render (single web service, `npm run build && npm start`) |

### 1.2 Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Service account JSON (stringified) — used for Vertex AI auth |
| `GOOGLE_CLOUD_PROJECT` | Yes | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | No (default `us-central1`) | Vertex AI region |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service-role key (bypasses RLS) |
| `NEO4J_URI` | No | Neo4j Aura URI — must use `neo4j+s://` scheme |
| `NEO4J_USER` | No (default `neo4j`) | Neo4j username |
| `NEO4J_PASSWORD` | No | Neo4j instance password |
| `GMAIL_CLIENT_ID` | No | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | No | Google OAuth client secret |
| `GMAIL_REDIRECT_URI` | No | OAuth callback URL |
| `GMAIL_REFRESH_TOKEN` | No | Long-lived refresh token (stored in DB after first auth) |
| `APP_URL` | No | Public base URL (used in OAuth redirect) |
| `PORT` | No (default `10000`) | HTTP server port |

> If Neo4j variables are absent, graph indexing and graph search are silently skipped; vector search is always used as the fallback.

### 1.3 Deployment

- **Build**: `npm run build` (runs `vite build` in `client/`)
- **Start**: `node server.js`
- Static frontend is served from `client/dist/` by Express
- Server credentials file: `GOOGLE_APPLICATION_CREDENTIALS_JSON` is written to a temp file at startup; path set into `GOOGLE_APPLICATION_CREDENTIALS` for the SDK

### 1.4 Organisational Structure

The platform serves one organisation split into four **internal parts** and three **external teams**:

| Part / Team | Type |
|-------------|------|
| Tech Management | Internal part |
| PRISM | Internal part |
| Data Management | Internal part |
| PMO | Internal part |
| MD | Managing Director (cross-part) |
| Team 1, Team 2, Team 3 | External teams |

### 1.5 User Roster (Seeded)

| User ID | Name | Role | Part / Team |
|---------|------|------|------------|
| `u_md` | Aryan Sharma | MD | — |
| `u_ph_tm` | Arjun Mehta | PartHead | Tech Management |
| `u_ph_prism` | John Iyer | PartHead | PRISM |
| `u_ph_dm` | Karan Shah | PartHead | Data Management |
| `u_ph_pmo` | Ranjit Bose | PartHead | PMO |
| `u_mem_tm` | Sam Patel | Member | Tech Management |
| `u_mem_prism` | Nadia Verma | Member | PRISM |
| `u_mem_dm` | Diego Alvarez | Member | Data Management |
| `u_mem_dm2` | Ravi Kumar | Member | Data Management |
| `u_mem_pmo` | Lina Joshi | Member | PMO |
| `u_th_t1` | Asha Rao | TeamHead | Team 1 |
| `u_mem_t1` | Vikram Singh | Member | Team 1 |
| `u_th_t2` | Marco Bianchi | TeamHead | Team 2 |
| `u_mem_t2` | Lea Fischer | Member | Team 2 |
| `u_th_t3` | Hiro Tanaka | TeamHead | Team 3 |
| `u_mem_t3` | Elena Costa | Member | Team 3 |

### 1.6 Access Control Model

Every resource in the system is scoped by `accessible_to[]` — a Postgres text array carrying part or team names. The rules:

| Role | Scope | Sees |
|------|-------|------|
| MD | Cross-part | All documents, all task forces, all chatroom messages, all action items |
| PartHead | Single part | Documents tagged with their part, chatroom, task forces in their part |
| Member (internal) | Single part | Documents tagged with their part, action items assigned to them |
| TeamHead | Single team | Documents tagged with their team, task forces in their team |
| Member (external) | Single team | Documents tagged with their team |

**`resolvePartFilter(user_id, part)`** is called at the start of every data-access request:
- MD → `null` filter (no restriction)
- PartHead/Member → returns the user's `part` value
- TeamHead/Member (external) → returns the user's `team` value

The Supabase RPC `match_chunks` accepts `part_filter` and applies `accessible_to @> array[part_filter]` before ranking.

---

## 2. Knowledge Hub

The Knowledge Hub is the core of the platform. It is an AI-powered document repository with semantic search, multi-model chat, graph-based retrieval, and report generation. Everything described here is rendered inside `KnowledgeHubTab.jsx` and backed by the `/api/upload`, `/api/chat/*`, `/api/report*`, and `/api/files/*` endpoints.

### 2.1 Document Upload & Ingestion Pipeline

**User flow:** User selects a file, optionally checks "Extract action items", and clicks Upload. The file goes through an 8-step pipeline before confirmation is returned.

#### Step 1 — HTTP ingest
`POST /api/upload` (multipart/form-data: `file`, `user_id`, `extract_action_items` flag)

#### Step 2 — Text extraction (`lib/extract.js`)

| Format | Method |
|--------|--------|
| PDF | `pdf-parse` — returns raw text |
| DOCX | `mammoth` — strips formatting, returns plain text |
| PPTX | `JSZip` — opens the archive, reads every `ppt/slides/slideN.xml`, extracts all `<a:t>` text nodes |
| XLSX | `xlsx` library — converts each sheet to CSV, concatenates |
| TXT | Raw buffer decode |

After extraction, **heading detection** runs on the text using heuristics (in priority order):
1. Markdown headings (`# Title`, `## Sub`)
2. Numbered sections (`1.`, `1.1`, `2.3.4`)
3. ALL-CAPS lines (≥ 4 chars, no trailing punctuation)
4. Title-Case lines followed by a blank line

Returns `{ text, headings: [{line, level, text}], slides? }`.

#### Step 3 — Chunking (`lib/chunk.js`)

| Document type | Strategy |
|---------------|---------|
| PPTX | One chunk per slide (slide text as a unit) |
| PDF/DOCX with headings | Split on heading boundaries; merge undersized chunks (< 300 words) upward; split oversized chunks (> 600 words) at paragraph breaks |
| Everything else | Merge consecutive paragraphs until 300–600 word window is full |

Each chunk also gets a **context prefix** — the nearest heading prepended to the chunk text for semantic clarity.

Config controls: `rag.chunk_min_words = 300`, `rag.chunk_max_words = 600`.

#### Step 4 — HyDE Enrichment (`lib/rag.js → enrichChunk`)

Each chunk is sent to Gemini in JSON mode. The model returns:
```json
{
  "summary": "2-3 sentence abstract of the chunk",
  "keywords": ["keyword1", "keyword2", ...],
  "hypothetical_questions": ["Q1?", "Q2?", "Q3?"]
}
```

The enrichment is stored in the `chunks` table (`chunk_summary`, `keywords[]`, `hypothetical_questions[]`).

#### Step 5 — Embedding (`lib/rag.js → embedText`)

The embedding input is constructed by concatenating:
```
{chunk_summary}
Keywords: {keywords joined by ", "}
Questions: {hypothetical_questions joined by " | "}
```

This HyDE input (hypothetical document enrichment) is embedded using `text-embedding-004` via a direct Vertex AI REST call:
```
POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/text-embedding-004:predict
Body: { instances: [{ content: "...", task_type: "RETRIEVAL_DOCUMENT" }], parameters: { outputDimensionality: 768 } }
```

Returns a 768-dimensional float array.

#### Step 6 — Supabase Storage

The raw file buffer is uploaded to the Supabase `documents` bucket. The public URL is stored in `files.file_url`.

A row is inserted into `files` with:
- `filename`, `filetype`, `file_url`
- `uploaded_by` (user name)
- `accessible_to[]` — MD uploads get all parts + all teams; PartHead uploads get their part; TeamHead uploads get their team

Each chunk is inserted into `chunks` with its `file_id` FK, raw text, enrichment fields, embedding vector, and `chunk_index`.

#### Step 7 — Graph Indexing (`lib/graphExtract.js → extractEntities → writeDocumentToGraph`)

This step runs only if `neo4jReady()` returns true.

**Entity extraction** — Gemini JSON mode (maxTokens: 2048) over the first 6,000 characters of document text:
```json
{
  "topics": ["topic1", "topic2"],
  "technologies": ["Python", "LLM"],
  "people": ["Alice", "Bob"],
  "projects": ["Project Alpha"],
  "decisions": ["Adopted microservices architecture"]
}
```

**Neo4j write** — `writeDocumentToGraph` runs a series of Cypher MERGE statements:
- Creates/merges a `Document` node: `{id, filename, filetype, fileUrl, uploadedBy, part}`
- For each topic → `MERGE (t:Topic {name:$name}) MERGE (d)-[:COVERS]->(t)`
- For each technology → `MERGE (t:Technology {name:$name}) MERGE (d)-[:MENTIONS_TECH]->(t)`
- For each person → `MERGE (p:Person {name:$name}) MERGE (d)-[:MENTIONS_PERSON]->(p)`
- For each project → `MERGE (p:Project {name:$name}) MERGE (d)-[:PART_OF]->(p)`
- For each decision → `CREATE (dec:Decision {text:$text, documentId:$id}) MERGE (d)-[:RECORDS]->(dec)`
- Cross-links: all topic pairs within the same document get a `RELATED_TO` edge

**Neo4j node types and relationships:**

```
Document -[:COVERS]---------> Topic
Document -[:MENTIONS_TECH]--> Technology
Document -[:MENTIONS_PERSON]-> Person
Document -[:PART_OF]---------> Project
Document -[:RECORDS]---------> Decision
Topic    -[:RELATED_TO]------> Topic   (bidirectional, co-occurrence)
```

#### Step 8 — Action Item Extraction (optional)

If the user checked "Extract action items" and the document is not XLSX/PPTX:
- `extractActionItems(text, model)` → Gemini JSON → array of `{id, text, completed: false}` objects
- The result is queued for the user to review (not auto-saved). Saved via `POST /api/action-items` after review.

---

### 2.2 Search & Retrieval

The Knowledge Hub supports two search paths that are either user-selected or auto-routed.

#### 2.2.1 Vector Search

1. User query is embedded using `text-embedding-004` with `task_type: RETRIEVAL_QUERY`
2. Supabase RPC `match_chunks(query_embedding, part_filter, 20)` runs HNSW cosine similarity
3. Returns top-20 chunks (with filename, file URL, similarity score, filetype)
4. **Reranking** — Gemini receives the query + top-20 chunk summaries and returns indices of the top-5 most semantically relevant chunks
5. Final top-5 chunks form the context window for answer generation

#### 2.2.2 Graph Search

Used when the query asks about relationships across documents ("everything about X", "all documents related to Y").

1. **Entity extraction from query** — same Gemini JSON call as ingestion, but on the query text
2. **Neo4j traversal** — for each entity type:
   - Topics: `MATCH (d:Document)-[:COVERS]->(t:Topic) WHERE t.name IN $topics` — returns matching Document IDs; also one-hop via `(t1)-[:RELATED_TO]-(t2)` to catch adjacent topics
   - Technologies: `MATCH (d:Document)-[:MENTIONS_TECH]->(t:Technology) WHERE t.name IN $techs`
   - People: `MATCH (d:Document)-[:MENTIONS_PERSON]->(p:Person) WHERE p.name IN $people`
   - Projects: `MATCH (d:Document)-[:PART_OF]->(p:Project) WHERE p.name IN $projects`
3. Unique Document IDs from all matches are collected
4. Supabase query: fetch chunks WHERE `file_id IN (matched_ids)` — up to 20 chunks
5. `part_filter` applied: `accessible_to @> array[part_filter]`
6. If graph returns 0 results → automatically falls back to vector search

#### 2.2.3 Query Router

`POST /api/chat/route` calls `routeQuery(query, model)` in `lib/graphExtract.js`.

Gemini classifies the query as `"vector"` or `"graph"` based on this heuristic:
- **Graph** → relational, cross-document, sweeping questions: "all documents about…", "everything related to…", "across the knowledge base…"
- **Vector** → specific fact retrieval, single-topic explanation, passage summary

Returns `{ search_type: "vector"|"graph", reason: string, entities: {...} }`.

The chat endpoint calls the router and then dispatches to the appropriate search path. If graph returns nothing, it falls back to vector automatically.

---

### 2.3 Chat Interface

**User flow:** User types a query in the chat window, selects a model, and receives a streaming response with cited sources.

#### Models Available

| UI Label | Model ID | Endpoint |
|----------|----------|---------|
| Gemini 2.5 Flash | `gemini-2.5-flash` | Vertex AI `@google/genai` SDK |
| Gemma 4 26B A4B IT | `google/gemma-4-26b-a4b-it-maas` | Vertex AI MaaS OpenAI-compat |
| GLM-5 | `zai-org/glm-5-maas` | Vertex AI MaaS OpenAI-compat |
| GPT OSS 20B | `openai/gpt-oss-20b-maas` | Vertex AI MaaS OpenAI-compat |

MaaS endpoint pattern:
```
POST https://aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi/chat/completions
```

#### Streaming Flow (`POST /api/chat/stream`)

1. Server resolves user scope and builds context block (same retrieval as above)
2. Sends `event: meta` SSE event immediately with `{ sources, eval_chunks, search_type }`
3. Begins streaming tokens:
   - Gemini: `generateContentStream()` async generator (awaited before iteration)
   - MaaS: `stream: true` in request body → server reads SSE response body, re-emits `data:` lines as `event: chunk` events
4. Sends `event: done` when stream ends; `event: error` on failure

**Client-side rendering:**
- Tokens are buffered in a `ref` and flushed once per animation frame (~60 fps) via `requestAnimationFrame` to avoid per-token re-renders
- ThinkingDots component (`. → . . → . . . → . . . .`) animates until first token arrives
- Empty streaming placeholder is not rendered until at least one token is received
- Sources, Search Badge (Vector/Graph), and RAG Eval button appear only after `event: done`

#### System Prompt (CHAT_SYSTEM)

> "You are a knowledge assistant with access to internal documents. Answer the user's question using only the context provided below. If the answer is not present in the context, say 'I could not find this in the uploaded documents' — do not use general knowledge. Always cite the source filename at the end of your answer."

#### Conversation History

Every request includes `conversation_history` — an array of `{role, content}` for all prior turns. The full history is passed to the LLM on each turn (no truncation, user manages by clearing).

#### Executive Chatroom Mode

When a MD or PartHead enables "Include Exec Chatroom as source":
- Context retrieval is replaced entirely with `getChatroomContext(query)` — vector search over `chatroom_chunks`
- Document search is skipped
- Response cites chatroom message summaries instead of files

#### RAG Evaluation (on-demand)

After a response, user can click "Evaluate Response". Sends `POST /api/chat/evaluate` with `{ query, answer, chunks }`. Three metrics computed via Gemini:

| Metric | What it measures |
|--------|----------------|
| Context Precision | What fraction of retrieved chunks are actually relevant to the query |
| Faithfulness | Whether the answer is grounded in the retrieved context (no hallucination) |
| Response Relevance | Whether the answer addresses the query directly |

Scores (0–1) are stored in `rag_evaluations` and running averages updated in `rag_eval_summary`.

---

### 2.4 Report Generator

Users can generate structured reports in two modes, with output as PDF, DOCX, or XLSX.

#### Mode 1 — Template-Based

**User flow:**
1. Admin uploads a DOCX or PDF template via `POST /api/report-templates` (stored in `report_templates` table, template text extracted)
2. User selects a template, picks source files, selects output model and format
3. `POST /api/report-templates/:id/generate` — server reads template text + full text of all selected files
4. Gemini receives the template as a format guide and the document content as source material
5. Returns structured HTML → rendered to PDF/DOCX/XLSX

#### Mode 2 — Free-Form (`POST /api/report/generate`)

User writes an instruction/prompt, selects files, and the model generates a report from scratch. Same render pipeline.

#### Output Rendering

| Format | Library | Notes |
|--------|---------|-------|
| PDF | Puppeteer (headless Chromium) | HTML → PDF with print media CSS |
| DOCX | html-to-docx | HTML → Office Open XML |
| XLSX | SheetJS | LLM generates JSON table schema → multi-sheet workbook |

All four models (Gemini, Gemma, GLM, GPT OSS) are selectable for report generation.

---

### 2.5 Library (File Management)

**User flow:** Users browse files they have access to, preview content, download, lock for offline editing, upload a new version, or delete.

#### File Locking (Checkout)

- `POST /api/files/:id/lock` — sets `locked_by_id`, `locked_by_name`, `locked_at` on the file row
- Other users see the file as locked and cannot replace it
- `POST /api/files/:id/unlock` — only the lock holder or MD can unlock
- Lock persists until explicitly released (no TTL)

#### Versioning

- `POST /api/files/:id/replace` — uploads a new version of a file at the same `file_id`
- Increments `version` counter, updates `updated_by` and `updated_at`
- Old chunks are deleted (cascade) and new chunks are ingested through the full pipeline

#### Deletion Cascade

Deleting a file (`DELETE /api/files/:id`) triggers:
1. Supabase: chunks deleted via FK cascade
2. Supabase: action_items linked to the file deleted via FK cascade
3. Neo4j: Document node detached and deleted, associated Decision nodes deleted

---

### 2.6 Knowledge Hub API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/upload` | Ingest file through full pipeline |
| `GET` | `/api/files` | List files scoped to user |
| `POST` | `/api/files/:id/replace` | Upload new version |
| `DELETE` | `/api/files/:id` | Delete file + cascade |
| `POST` | `/api/files/:id/lock` | Checkout file |
| `POST` | `/api/files/:id/unlock` | Release checkout |
| `POST` | `/api/retrieve` | Ad-hoc vector search |
| `POST` | `/api/chat/route` | Classify query (vector vs. graph) |
| `POST` | `/api/chat` | Non-streaming RAG chat |
| `POST` | `/api/chat/stream` | Streaming RAG chat (SSE) |
| `POST` | `/api/chat/evaluate` | Compute RAG eval metrics |
| `GET` | `/api/chat/eval-summary` | Running eval averages |
| `GET` | `/api/report-templates` | List templates |
| `POST` | `/api/report-templates` | Upload template |
| `DELETE` | `/api/report-templates/:id` | Delete template |
| `POST` | `/api/report-templates/:id/generate` | Generate from template |
| `POST` | `/api/report-templates/:id/generate-from-files` | Batch template fill |
| `POST` | `/api/report/generate` | Free-form report |
| `POST` | `/api/render-pdf` | HTML → PDF |
| `POST` | `/api/render-docx` | HTML → DOCX |
| `POST` | `/api/render-xlsx` | JSON → XLSX |
| `POST` | `/api/xlsx/compile` | Multi-sheet XLSX |

---

### 2.7 Database Schema (Knowledge Hub Tables)

#### `files`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | Auto-generated |
| `filename` | `text` | Original filename |
| `filetype` | `text` | MIME or extension |
| `file_url` | `text` | Supabase Storage public URL |
| `uploaded_by` | `text` | Uploader's display name |
| `accessible_to` | `text[]` | Part/team names that can access |
| `uploaded_at` | `timestamptz` | Upload timestamp |
| `version` | `integer` | Starts at 1, increments on replace |
| `updated_by` | `text` | Name of last updater |
| `updated_at` | `timestamptz` | Timestamp of last replace |
| `locked_by_id` | `text` | User ID of lock holder |
| `locked_by_name` | `text` | Display name of lock holder |
| `locked_at` | `timestamptz` | When lock was taken |

#### `chunks`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | Auto-generated |
| `file_id` | `uuid FK → files(id)` | CASCADE on delete |
| `chunk_text` | `text` | Raw chunk with context prefix |
| `chunk_summary` | `text` | Gemini-generated summary |
| `keywords` | `text[]` | Gemini-extracted keywords |
| `hypothetical_questions` | `text[]` | Gemini-generated questions |
| `embedding` | `vector(768)` | text-embedding-004 output |
| `chunk_index` | `integer` | Position in document |
| `created_at` | `timestamptz` | — |

**Index:** `chunks_embedding_idx` — HNSW on `embedding` with `vector_cosine_ops`

#### `report_templates`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `filename` | `text` | — |
| `filetype` | `text` | — |
| `file_url` | `text` | Supabase Storage URL |
| `template_text` | `text` | Extracted raw text of template |
| `uploaded_by` | `text` | — |
| `uploaded_at` | `timestamptz` | — |

#### `rag_evaluations`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `query` | `text` | User query |
| `answer` | `text` | Model response |
| `context_precision` | `float` | 0–1 |
| `faithfulness` | `float` | 0–1 |
| `response_relevance` | `float` | 0–1 |
| `created_at` | `timestamptz` | — |

#### `rag_eval_summary` (single row, id=1)
| Column | Type |
|--------|------|
| `avg_context_precision` | `float` |
| `avg_faithfulness` | `float` |
| `avg_response_relevance` | `float` |
| `total_count` | `integer` |
| `updated_at` | `timestamptz` |

#### RPC: `match_chunks`
```sql
match_chunks(
  query_embedding vector(768),
  part_filter     text default null,
  match_count     int  default 20
)
```
Returns top-k chunks ordered by cosine similarity. Applies `accessible_to @> array[part_filter]` when `part_filter` is not null. Returns chunk fields + joined `filename`, `filetype`, `file_url`, `uploaded_by`.

---

### 2.8 Configuration Reference (`config.json`)

```json
{
  "models": {
    "scoring":      "gemini-2.5-flash",
    "summarisation":"gemini-2.5-flash",
    "enrichment":   "gemini-2.5-flash",
    "reranker":     "gemini-2.5-flash",
    "chat":         "gemini-2.5-flash"
  },
  "embeddingModel":      "text-embedding-004",
  "embeddingDimensions": 768,
  "rag": {
    "vector_search_top_k": 20,
    "rerank_top_n":        5,
    "chunk_min_words":     300,
    "chunk_max_words":     600
  }
}
```

To swap a model, change the value in `config.json` and restart the server. No code changes needed (all model keys are resolved at request time via `config.models.*`).

---

## 3. Feed

The Tech Sensing Feed is an AI-curated news aggregator. Each part sees articles relevant to their domain, scored and summarised by Gemini.

### 3.1 How the Feed Works

**User flow:** User opens the Feed tab → sees latest articles grouped by source → can trigger a refresh, search live, or generate a worklet from any article.

**Pipeline (`lib/feed.js → runFeedPipeline`):**

1. For each configured RSS source (filtered to the user's part):
   - Attempt RSS fetch → parse items (title, link, pubDate, description)
   - If the source has `geminiSearch: true` or RSS fetch fails → fallback to Gemini Google Search grounding: Gemini visits the source URL, finds article links, returns structured results
2. For each article, Gemini scores relevance to the part (1–10) and categorises it
3. Results grouped by source, top N per source (default 5; MD gets 3; PMO gets 10)
4. Cached in memory (`memoryFeedCache`) and persisted to `feed_cache` table per part

**Cache key:** `part:{partName}` or `latest` for MD.

### 3.2 Feed Sources (Active)

| Source | Parts |
|--------|-------|
| Hugging Face Blog | Tech Management, PRISM |
| MarkTechPost | Tech Management, PRISM |
| TechCrunch AI | Tech Management, PRISM |
| Times of India Tech | Tech Management, PRISM |
| Engadget | Tech Management, PRISM |
| Rebel's Guide to PM | PMO |
| ProjectManager Blog | PMO |
| Project Times | PMO |
| PM Today | PMO |
| Scrum Expert | PMO |
| mostly.ai Blog | Data Management |
| LabelYourData Blog | Data Management |
| Microsoft News | MD |
| NVIDIA AI News | MD |
| Intel Newsroom | MD |

Data Management sources use `geminiSearch: true` (Gemini grounding instead of RSS) because those sites don't publish RSS feeds.

### 3.3 Live Search

`POST /api/feed/live-search` — takes a free-form query, calls `generateTextWithSearch` (Gemini with Google Search grounding), returns up to 10 results with source URLs and snippets from `groundingChunks`.

### 3.4 Worklet Generation

`POST /api/worklet` — sends an article title + URL to Gemini (with thinking enabled). Returns a 130–160 word technical digest suitable for a briefing note. Thinking is enabled for this call to allow deeper reasoning.

### 3.5 Feed API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/feed` | Cached feed for user's part |
| `GET` | `/api/feed/sources` | List sources for user's part |
| `POST` | `/api/feed/sources` | Add new RSS source |
| `POST` | `/api/feed/refresh` | Trigger fresh pipeline run (async) |
| `POST` | `/api/feed/live-search` | Gemini grounded live search |
| `GET` | `/api/leaderboard` | LLM leaderboard (cached 1 h) |
| `POST` | `/api/worklet` | Generate article digest |

---

## 4. Home Page

The Home Page is a role-specific dashboard. Its content adapts entirely based on the logged-in user's role and part.

### 4.1 MD Dashboard

- **Task Force summary** — lists all active task forces across all parts/teams, counts by status (Active / On Hold / Closed)
- **Market Intelligence stats** — feed item counts by part for the last refresh

### 4.2 Tech Management Part Head

- **PRISM / Project metrics** — key stats for projects tracked under PRISM (progress, milestones, risks)
- **Quick navigation** to Knowledge Hub filtered to Tech Management documents

### 4.3 Data Management Part Head

- **Dataset KPI table** — per-dataset targets vs. received vs. accepted row counts
- Quick link to upload new data reports

### 4.4 General Members

- Welcome panel with their name and part/team
- Quick links to Knowledge Hub and Action Items

### 4.5 Navigation Visibility by Role

The sidebar/tab bar shows tabs selectively:

| Tab | MD | PartHead | TeamHead | Member |
|-----|----|---------|---------|--------|
| Home | ✓ | ✓ | ✓ | ✓ |
| Knowledge Hub | ✓ | ✓ | ✓ | ✓ |
| Feed | ✓ | ✓ | ✗ | ✗ |
| Action Items | ✓ | ✓ | ✓ | ✓ |
| Minutes (Voice MoM) | ✓ | ✓ | ✓ | ✓ |
| Task Forces | ✓ | ✓ | ✓ | ✓ |
| Chatroom | ✓ | ✓ | ✗ | ✗ |

### 4.6 Home API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/users` | All users (for role switching) |
| `GET` | `/api/parts` | List parts from config |
| `GET` | `/api/health` | Server health + RAG readiness status |

---

## 5. Utilities

### 5.1 Action Items

Action items are AI-extracted or manually created tasks, organised into cards.

#### Sources

| Source Type | How created |
|-------------|------------|
| `file` | Extracted from uploaded document at upload time |
| `mom` | Extracted from a saved Minutes of Meeting |
| `manual` | Created directly by user in the Action Items tab |

#### Card Structure

Each card (row in `action_items`) contains a `items` JSONB array:
```json
[
  {
    "id": "uuid",
    "text": "Review Q3 budget proposal",
    "completed": false,
    "assignees": ["u_mem_tm"],
    "due_date": "2025-06-01",
    "parent_item_id": null
  }
]
```

Sub-items are supported via `parent_item_id` referencing another item's `id`.

#### Database Table: `action_items`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `file_id` | `uuid FK → files(id)` | Null for MoM/manual |
| `filename` | `text` | Display name |
| `accessible_to` | `text[]` | Part/team scope |
| `items` | `jsonb` | Array of task objects |
| `assigned_by` | `text` | Reviewer who saved the card |
| `source_type` | `text` | `'file'` \| `'mom'` \| `'manual'` |
| `source_id` | `uuid` | FK to source (MoM id if mom) |
| `created_at` | `timestamptz` | — |
| `updated_at` | `timestamptz` | — |

#### Action Items API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/action-items` | List cards for user's scope |
| `POST` | `/api/action-items` | Save reviewed card |
| `POST` | `/api/action-items/extract/:file_id` | Re-extract from file (preview only, no save) |
| `PATCH` | `/api/action-items/:id` | Update status / assignees / sub-items |
| `DELETE` | `/api/action-items/:id` | Delete card |

---

### 5.2 Voice-based MoM (Minutes of Meeting)

The Minutes feature allows users to record meetings on-device and have them automatically transcribed, structured, and stored.

#### User Flow

1. User records audio in the browser (MediaRecorder API) or uploads an audio file
2. `POST /api/minutes/transcribe` — audio file → **OpenAI Whisper** (local model) → raw transcript text
3. `POST /api/minutes/parse` — transcript → **Gemini** JSON parse → structured object:
   ```json
   {
     "title": "Meeting title",
     "summary": "2-3 sentence overview",
     "attendees": ["Alice", "Bob"],
     "decisions": ["Adopted new deployment strategy"],
     "action_items": [{"text": "...", "assignee": "Alice", "due": "2025-06-01"}]
   }
   ```
4. User reviews the parsed output and can:
   - **Save MoM** → `POST /api/minutes` (persisted to `minutes` table)
   - **Extract action items** → routes to Action Items review flow
   - **Save to Knowledge Hub** → `POST /api/minutes/:id/save-to-hub` → MoM text stored as a document and goes through the full ingestion pipeline (chunked, embedded, graph-indexed)

#### Database Table: `minutes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `title` | `text` | Meeting title |
| `summary` | `text` | AI-generated summary |
| `attendees` | `jsonb` | Array of attendee names |
| `decisions` | `jsonb` | Array of decision strings |
| `action_items` | `jsonb` | Array of `{text, assignee, due}` |
| `transcript` | `text` | Raw Whisper output |
| `created_by` | `text` | User ID |
| `accessible_to` | `text[]` | Part/team scope |
| `created_at` | `timestamptz` | — |

**Index:** `minutes_accessible_idx` — GIN index on `accessible_to`

#### Voice MoM API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/minutes/transcribe` | Audio → Whisper transcript |
| `POST` | `/api/minutes/parse` | Transcript → Gemini structured parse |
| `GET` | `/api/minutes` | List saved MoMs for user |
| `POST` | `/api/minutes` | Save parsed MoM |
| `DELETE` | `/api/minutes/:id` | Delete MoM |
| `POST` | `/api/minutes/:id/extract-action-items` | AI extract + preview (no save) |
| `POST` | `/api/minutes/:id/save-to-hub` | Ingest MoM as Knowledge Hub document |

---

### 5.3 Task Forces

Task Forces are cross-functional workgroups that span multiple parts and/or external teams.

#### User Flow

1. MD, PartHead, or TeamHead creates a Task Force: name, scope (parts[], teams[]), owners[], members[]
2. Task Force appears in the Task Forces tab for everyone in scope
3. Members log updates (status, milestones, risks, decisions, action items) which appear in a chronological feed
4. Status can be Active / On Hold / Closed

#### Visibility Rules

| Role | Sees |
|------|------|
| MD | All task forces |
| PartHead | Task forces scoped to their part |
| TeamHead | Task forces scoped to their team |
| Member | Task forces where they are listed in `members[]` |

#### Database Tables

**`task_forces`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `name` | `text` | — |
| `status` | `text` | `'Active'` \| `'On Hold'` \| `'Closed'` |
| `parts` | `text[]` | Participating internal parts |
| `teams` | `text[]` | Participating external teams |
| `owners` | `text[]` | User IDs (auto-include creating Part/Team Head) |
| `members` | `text[]` | User IDs |
| `created_by` | `text` | — |
| `created_at` | `timestamptz` | — |
| `updated_at` | `timestamptz` | — |

**`tf_updates`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `tf_id` | `uuid FK → task_forces` | CASCADE |
| `type` | `text` | `'Status'` \| `'Milestone'` \| `'Risk'` \| `'Decision'` \| `'ACTION_ITEM'` |
| `author` | `text` | User name |
| `content` | `text` | Update body |
| `created_at` | `timestamptz` | — |

**`tf_action_items`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `tf_id` | `uuid FK → task_forces` | CASCADE |
| `text` | `text` | Task description |
| `assignee` | `text` | User ID |
| `due` | `date` | Due date |
| `done` | `boolean` | Default false |
| `created_at` | `timestamptz` | — |

#### Task Forces API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/task-forces` | List visible task forces |
| `POST` | `/api/task-forces` | Create task force |
| `PATCH` | `/api/task-forces/:id` | Update name/status/scope |
| `DELETE` | `/api/task-forces/:id` | Delete (owner or MD) |
| `POST` | `/api/task-forces/:id/updates` | Log update |
| `POST` | `/api/task-forces/:id/action-items` | Add action item |
| `PATCH` | `/api/task-forces/:id/action-items/:aid` | Mark done / edit |

---

### 5.4 Executive Chatroom

A private messaging channel accessible only to MD and PartHeads.

#### User Flow

1. MD or PartHead opens Chatroom tab
2. Sends messages grouped by `conversation_id`
3. Messages are stored in `chatroom_messages`
4. **Nightly at 7am** — `POST /api/admin/chatroom/process-chunks` partitions that day's messages into topical chunks, embeds them, and stores them in `chatroom_chunks`
5. When a MD/PartHead enables "Include Exec Chatroom as source" in the chat panel, the RAG retrieval is redirected to `match_chatroom_chunks` instead of document chunks

#### Database Tables

**`chatroom_messages`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `conversation_id` | `text` | Groups related messages |
| `sender_id` | `text` | — |
| `sender_name` | `text` | — |
| `content` | `text` | — |
| `created_at` | `timestamptz` | — |

**Index:** `chatroom_messages_conv_idx` on `(conversation_id, created_at)`

**`chatroom_chunks`** — processed nightly

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | — |
| `chunk_text` | `text` | Merged topical messages |
| `topic_summary` | `text` | Gemini summary of the chunk |
| `embedding` | `vector(768)` | HNSW indexed |
| `processed_date` | `date` | Day the messages are from |
| `created_at` | `timestamptz` | — |

**RPC: `match_chatroom_chunks(query_embedding, match_count=5)`** — returns top-k chatroom chunks by cosine similarity.

#### Chatroom API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/chatroom` | List messages |
| `POST` | `/api/chatroom` | Send message |
| `DELETE` | `/api/chatroom/:id` | Delete message |
| `POST` | `/api/admin/chatroom/process-chunks` | Nightly chunk processing job |

---

### 5.5 Gmail Integration

Allows authorised users to connect their Gmail inbox and use email content as a source for action items and documents.

#### OAuth Flow

1. `GET /api/email/auth` — redirects user to Google OAuth consent screen (scope: `gmail.readonly`)
2. User approves → Google calls back `GET /api/email/callback?code=...`
3. Server exchanges code for tokens → stores in `email_tokens` table under key `'gmail'`
4. `GET /api/email/status` — returns `{ connected: true/false }`

#### Email Operations

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List emails | `GET /api/email/messages?max=50` | INBOX emails with subject, from, date, body, attachments |
| Summarise | `POST /api/email/summarize` | Gemini bullet-point digest (flags actions + deadlines) |
| Extract actions | `POST /api/email/extract-actions` | Gemini → action items from thread |
| Upload attachment | `POST /api/email/upload-attachment` | Ingest email attachment as Knowledge Hub document |

#### Database Table: `email_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `key` | `text PK` | Always `'gmail'` |
| `tokens` | `jsonb` | `{access_token, refresh_token, expiry_date, ...}` |
| `updated_at` | `timestamptz` | — |

---

### 5.6 AI Quizzes

A knowledge assessment tool. Users take a 5-question quiz on RAG/AI fundamentals; scores are saved and a leaderboard is shown.

#### User Flow

1. User opens Quizzes tab → sees quiz title and questions (`quiz_id: 'rag-basics'`)
2. Submits answers → score computed client-side
3. `POST /api/quiz/score` → upserts into `quiz_scores` (latest attempt overrides)
4. Leaderboard (`GET /api/quiz/leaderboard`) shows all users ranked by score, then by most recent attempt

#### Database Table: `quiz_scores`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `text PK` | One row per user per quiz |
| `user_name` | `text` | — |
| `quiz_id` | `text` | `'rag-basics'` |
| `score` | `integer` | Correct answers |
| `total` | `integer` | Default 5 |
| `attempted_at` | `timestamptz` | Updated on each attempt |

#### Quizzes API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/quiz/leaderboard` | Ranked scores |
| `POST` | `/api/quiz/score` | Save / update attempt |

---

### 5.7 `lib/` Module Reference

| File | Purpose |
|------|---------|
| `lib/clients.js` | Supabase singleton + `ragReady()` health check |
| `lib/llm.js` | All LLM wrappers: `generateText`, `generateChat`, `generateChatStream`, `generateChatGemma/GLM/GPTOSS` (sync + stream variants) |
| `lib/rag.js` | `enrichChunk`, `embedText` (Vertex REST), `buildEmbeddingInput`, `rerankChunks`, `stripJsonFences` |
| `lib/graphExtract.js` | `extractEntities`, `writeDocumentToGraph`, `deleteDocumentFromGraph`, `routeQuery`, `graphSearch` |
| `lib/neo4j.js` | Neo4j driver singleton, `neo4jReady()`, `runQuery()`, `initConstraints()` |
| `lib/chunk.js` | `chunkDocument()` (format-aware), `addContextPrefix()` |
| `lib/extract.js` | `extractText()` dispatcher across PDF/DOCX/PPTX/XLSX/TXT, heading detection |
| `lib/feed.js` | `runFeedPipeline()` — RSS fetch + Gemini grounding fallback |
| `lib/actionItems.js` | `extractActionItems()` — Gemini JSON mode, regex fallback |
| `lib/htmlToPdf.js` | Puppeteer HTML→PDF |
| `lib/htmlToDocx.js` | html-to-docx wrapper |

---

*End of documentation. Last updated: May 2026.*
