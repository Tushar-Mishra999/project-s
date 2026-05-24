# KERNEL — Technical Reference Document

> **Audience:** Engineers onboarding to this codebase or continuing its development.  
> **Purpose:** Exhaustive explanation of every major feature — what it does, how it works internally, which libraries are used, and where the data lives.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Structure](#2-repository-structure)
3. [Tech Stack](#3-tech-stack)
4. [Environment Variables](#4-environment-variables)
5. [Database Schema](#5-database-schema)
6. [Document Upload Pipeline](#6-document-upload-pipeline)
7. [Knowledge Hub — Vector Search](#7-knowledge-hub--vector-search)
8. [Knowledge Hub — Graph Search](#8-knowledge-hub--graph-search)
9. [Insights Chatbot](#9-insights-chatbot)
10. [Executive Chatroom & Chatroom RAG](#10-executive-chatroom--chatroom-rag)
11. [AI Document Studio — Report Generator](#11-ai-document-studio--report-generator)
12. [AI Document Studio — Refiner](#12-ai-document-studio--refiner)
13. [AI-Transcribed Minutes of Meeting](#13-ai-transcribed-minutes-of-meeting)
14. [Action Item Tracker](#14-action-item-tracker)
15. [Intelligence Feed (Tech Sensing)](#15-intelligence-feed-tech-sensing)
16. [AI Literacy Quizzes](#16-ai-literacy-quizzes)
17. [Task Forces](#17-task-forces)
18. [Report Templates](#18-report-templates)
19. [RAG Evaluation](#19-rag-evaluation)
20. [API Endpoint Reference](#20-api-endpoint-reference)
21. [Configuration Reference (config.json)](#21-configuration-reference-configjson)
22. [Alternative Codebase Stack](#22-alternative-codebase-stack)

---

## 1. System Overview

KERNEL is a unified AI platform built for the R&D Strategy Group (RSG) at Samsung Research. It eliminates fragmented knowledge, manual workflows, and isolated tooling across four internal teams: **Tech Management, PRISM, PMO, and Data Management**.

The platform is a Node.js (ESM) Express backend with a React frontend (Vite). Everything runs as a single server process — the backend serves both the API and (in production) the built React static files.

The core capabilities are:

| Capability | What it does |
|---|---|
| Knowledge Hub | Upload documents, ask questions in plain English, get cited answers |
| Insights Chatbot | Conversational RAG over the knowledge base |
| Intelligence Feed | Curated AI/tech news per department, auto-filtered and scored |
| Report Generator | LLM-generated structured reports from uploaded source files |
| Document Refiner | In-place grammar/phrasing improvements with auto re-indexing |
| AI-Transcribed MoM | Audio or text → structured minutes with action items |
| Action Item Tracker | Org-wide tracker with assignees, sub-tasks, and auto-extraction |
| Task Forces | Cross-departmental working groups with their own feed and tracker |
| AI Literacy Quizzes | Knowledge-check quizzes with persistent scores and a leaderboard |
| Executive Chatroom | Private 1:1 / group channel with RAG over conversation history |

---

## 2. Repository Structure

```
project-s/
├── server.js                  # Main Express server — all API routes
├── config.json                # Runtime configuration (sources, models, RAG params)
├── supabase-setup.sql         # Full PostgreSQL/pgvector schema (run once)
├── package.json
├── lib/
│   ├── llm.js                 # LLM client (Gemini via Vertex AI, Gemma, GLM, GPT-OSS)
│   ├── rag.js                 # Embedding, enrichment, reranking
│   ├── chunk.js               # Document chunking logic
│   ├── extract.js             # Text extraction from PDF/DOCX/PPTX/XLSX
│   ├── graphExtract.js        # Neo4j entity extraction, write, and graph search
│   ├── clients.js             # Supabase client singleton
│   ├── neo4j.js               # Neo4j driver singleton + constraint init
│   ├── feed.js                # RSS/feed pipeline, scoring, filtering
│   ├── actionItems.js         # Action item extraction via LLM
│   ├── htmlToPdf.js           # HTML → PDF via Puppeteer
│   └── htmlToDocx.js          # HTML → DOCX
└── client/                    # React + Vite frontend
```

---

## 3. Tech Stack

### Backend
| Layer | Technology | Library |
|---|---|---|
| Server | Node.js (ESM), Express | `express` |
| File uploads | Multer (memory storage) | `multer` |
| LLM (primary) | Google Gemini 2.5 Flash via Vertex AI | `@google/genai` |
| LLM (secondary) | Gemma 4 26B, GLM 5, GPT-OSS-20B via Vertex MaaS | `@google/genai` + raw fetch |
| Embeddings | Google `text-embedding-004` (768-dim) via Vertex AI REST | `google-auth-library` |
| Vector DB | Supabase PostgreSQL + pgvector (HNSW index) | `@supabase/supabase-js` |
| Graph DB | Neo4j (AuraDB or self-hosted) | `neo4j-driver` |
| File storage | Supabase Storage (S3-compatible) | `@supabase/supabase-js` |
| PDF parsing | pdf-parse | `pdf-parse` |
| DOCX parsing | Mammoth | `mammoth` |
| PPTX parsing | JSZip (custom XML parse) | `jszip` |
| XLSX parsing | SheetJS | `xlsx` |
| PDF export | Puppeteer + Chromium | `puppeteer-core`, `@sparticuz/chromium` |
| DOCX export | html-to-docx | `html-to-docx` |
| RSS parsing | rss-parser | `rss-parser` |
| Markdown render | marked | `marked` |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build tool | Vite |
| Routing | React Router |
| HTTP client | Native fetch |

### Models used (configurable in `config.json`)

| Role | Model |
|---|---|
| Scoring (feed relevance) | `gemini-2.5-flash` |
| Summarisation (reports, MoM) | `gemini-2.5-flash` |
| Enrichment (chunk enrichment on upload) | `gemini-2.5-flash` |
| Reranker | `gemini-2.5-flash` |
| Chat (chatbot, routing, entities) | `gemini-2.5-flash` |
| Embeddings | `text-embedding-004` (768 dimensions) |

---

## 4. Environment Variables

```
SUPABASE_URL                      Supabase project URL
SUPABASE_SERVICE_KEY              Supabase service role key (bypasses RLS)
GOOGLE_APPLICATION_CREDENTIALS    Path to GCP service account JSON (written by server at start)
GOOGLE_APPLICATION_CREDENTIALS_JSON  The JSON content of the service account key
GOOGLE_CLOUD_PROJECT              GCP project ID
GOOGLE_CLOUD_LOCATION             Vertex AI region (default: us-central1)
NEO4J_URI                         bolt:// or neo4j+s:// URI
NEO4J_USER                        Neo4j username
NEO4J_PASSWORD                    Neo4j password
PORT                              Express port (default: 3000)
```

Both Gemini and the embedding API use the same GCP service account. Neo4j vars are optional — if absent, all graph operations are silently skipped and vector search is used as fallback.

---

## 5. Database Schema

All tables live in Supabase (PostgreSQL). The full DDL is in `supabase-setup.sql`.

### Core tables

#### `files`
Stores metadata for every uploaded document.
```
id              uuid PK
filename        text
filetype        text          (mime + extension, e.g. "application/pdf .pdf")
file_url        text          (public Supabase Storage URL)
uploaded_by     text          (user_id)
accessible_to   text[]        (array of parts/roles that can see this file)
version         integer       (increments on each replace)
updated_by      text
updated_at      timestamptz
locked_by_id    text          (user_id currently editing)
locked_by_name  text
locked_at       timestamptz
uploaded_at     timestamptz
```

#### `chunks`
Stores every text chunk from every uploaded document, plus its vector embedding.
```
id                     uuid PK
file_id                uuid FK → files(id) ON DELETE CASCADE
chunk_text             text          ← the actual 300-600 word passage
chunk_summary          text          ← LLM-generated 2-3 sentence summary
keywords               text[]        ← 5-8 LLM-extracted keywords
hypothetical_questions text[]        ← 3-5 questions this chunk would answer
embedding              vector(768)   ← text-embedding-004 on the enriched text
chunk_index            integer       ← position within the source document
created_at             timestamptz
```
**Index:** HNSW (`chunks_embedding_idx`) on `embedding` using cosine distance — enables sub-millisecond approximate nearest-neighbour search.

#### `files` + `chunks` relationship
One file → many chunks (cascade delete). When a file is deleted or replaced, all its chunks are automatically removed.

### Other tables

| Table | Purpose |
|---|---|
| `users` | Org members with role (`MD`, `PartHead`, `Member`, `TeamHead`), part, and team |
| `feed_cache` | Single-row JSON cache for the latest Intelligence Feed run per part |
| `action_items` | Per-document/MoM action item lists (JSONB array of `{id, text, completed, assignees}`) |
| `minutes` | Saved MoM records (title, summary, attendees, decisions, action_items, transcript) |
| `quiz_scores` | Latest quiz score per user (`user_id` PK — retaking overwrites) |
| `report_templates` | Uploaded templates with extracted text for report generation |
| `task_forces` | Cross-team working groups with owners, members, parts, teams |
| `tf_updates` | Feed of status updates/milestones/decisions per task force |
| `tf_action_items` | Action items scoped to a task force (assignee, due date, done flag) |
| `chatroom_messages` | Executive chatroom messages (sender, content, conversation_id) |
| `chatroom_chunks` | Nightly AI-partitioned topical segments of chatroom messages + embeddings |
| `email_tokens` | Gmail OAuth refresh tokens |
| `rag_evaluations` | Per-query RAG quality scores (precision, faithfulness, relevance) |
| `rag_eval_summary` | Rolling averages of RAG evaluation metrics |

### pgvector RPC functions

Two SQL functions are registered in Supabase as RPCs (callable from the JS client):

**`match_chunks(query_embedding, part_filter, match_count)`**  
Filters chunks by `accessible_to` (part-scoped access), then returns top-k by cosine similarity.

**`match_chatroom_chunks(query_embedding, match_count)`**  
No date filter — returns top-k chatroom chunks by cosine similarity across all processed dates.

---

## 6. Document Upload Pipeline

**Entry point:** `POST /api/files/upload`  
**File:** `server.js` (route handler) + `lib/extract.js` + `lib/chunk.js` + `lib/rag.js` + `lib/graphExtract.js`

This is the most complex pipeline in the system. When a user uploads a document, six sequential steps execute:

### Step 1 — Text Extraction (`lib/extract.js`)

The buffer from Multer is passed to `extractText(buffer, filetype)` which dispatches by file type:

| Format | Parser | Notes |
|---|---|---|
| PDF | `pdf-parse` | Returns raw text + heuristic heading detection |
| DOCX | `mammoth` (raw text mode) | Avoids HTML conversion which silently drops table content |
| PPTX | `jszip` — custom XML parse | Reads `ppt/slides/slideN.xml`, extracts `<a:t>` text nodes. Returns one entry per slide |
| XLSX | `SheetJS` (`xlsx`) | Each sheet converted to CSV, sheet names become headings |
| TXT | Raw UTF-8 decode | |

Returns: `{ text: string, headings: [{line, level, text}], slides?: string[] }`

**Heading detection (PDF/DOCX):** Four heuristics checked in order — Markdown `#` style, numbered sections (`1.`, `2.1`), short ALL-CAPS lines, short Title Case lines followed by a blank line.

### Step 2 — Chunking (`lib/chunk.js`)

`chunkDocument(extracted, { chunk_min_words: 300, chunk_max_words: 600 })` dispatches on document type:

- **PPTX:** One chunk per slide (from `slides[]` array)
- **PDF/DOCX with ≥2 detected headings:** `chunkByHeadings` — splits on section boundaries, sub-splits oversized sections, merges undersized consecutive sections until each chunk reaches the minimum word count
- **Everything else:** `chunkByParagraphs` — accumulates paragraphs into a buffer, flushes when adding the next paragraph would exceed the max

Then `addContextPrefix` prepends the nearest heading (`[Heading]\n\n...`) to every chunk so the LLM has structural context even for isolated passages.

### Step 3 — Supabase Storage Upload

The original file buffer is uploaded to the `documents` Supabase Storage bucket. A UUID prefix is added to the filename to avoid collisions. A public URL is returned and stored in `files.file_url`.

### Step 4 — `files` Row Insert

A row is inserted into the `files` table with metadata: filename, filetype, file_url, uploaded_by, accessible_to (the parts/roles array), version.

### Step 5 — Per-chunk: Enrich → Embed → Store

For each chunk, three sub-steps run sequentially:

**5a. Enrichment (`lib/rag.js` → `enrichChunk`)**  
An LLM call (model: `config.models.enrichment`) generates:
```json
{
  "summary": "2-3 sentence summary of this chunk",
  "keywords": ["keyword1", "keyword2", ...],
  "hypothetical_questions": ["Q a user might ask?", ...]
}
```
This is the **Hypothetical Document Embedding (HyDE)** pattern — instead of embedding the raw chunk text directly, we embed a richer representation of what the chunk *means*.

**5b. Build embedding input**  
`buildEmbeddingInput(enriched)` concatenates: `summary + "\n" + keywords.join(", ") + "\n" + hypothetical_questions.join(" ")`.  
If enrichment failed, falls back to raw `chunk.text.slice(0, 2000)`.

**5c. Embedding (`lib/rag.js` → `embedText`)**  
Calls the Vertex AI embedding REST endpoint:
```
POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/text-embedding-004:predict
```
With `task_type: "RETRIEVAL_DOCUMENT"` and `outputDimensionality: 768`.  
Returns a 768-float array.

**5d. Insert chunk row**  
Stores `chunk_text` (raw passage), `chunk_summary`, `keywords`, `hypothetical_questions`, `embedding` (768-vector), `chunk_index`, `file_id` into `chunks`.

### Step 6 — Graph Indexing (`lib/graphExtract.js`)

Non-blocking (`.catch()` only, does not block the upload response). If Neo4j is configured:

1. `extractEntities(text)` sends the first 6,000 characters to an LLM which returns structured JSON:
   ```json
   {
     "topics": ["cloud migration", "q3 planning"],
     "technologies": ["kubernetes", "react"],
     "people": ["Arjun Mehta"],
     "projects": ["Project X"],
     "decisions": ["decided to migrate to k8s", ...]
   }
   ```

2. `writeDocumentToGraph(...)` writes to Neo4j:
   - `MERGE (d:Document {id})` — upsert document node
   - Per topic: `MERGE (t:Topic {name})` + `(d)-[:COVERS]->(t)`
   - Per technology: `MERGE (t:Technology {name})` + `(d)-[:MENTIONS_TECH]->(t)`
   - Per person: `MERGE (p:Person {name})` + `(d)-[:MENTIONS_PERSON]->(p)`
   - Per project: `MERGE (p:Project {name})` + `(d)-[:PART_OF]->(p)`
   - Per decision: `MERGE (dec:Decision {text, documentId})` + `(d)-[:RECORDS]->(dec)`
   - **Topic co-occurrence edges:** `(t1)-[:RELATED_TO]-(t2)` for every pair of topics in the same document — this enables one-hop graph traversal during search

**Neo4j constraints (created at server startup):**
- `Document.id` UNIQUE
- `Topic.name` UNIQUE
- `Technology.name` UNIQUE
- `Person.name` UNIQUE
- `Project.name` UNIQUE

---

## 7. Knowledge Hub — Vector Search

**Triggered by:** Insights Chatbot queries routed to vector, or graph fallback.  
**File:** `lib/rag.js` → `embedText`, `rerankChunks`; `server.js` → `match_chunks` RPC

### Full flow

```
User query
    │
    ▼
embedText(query, 'text-embedding-004', 'query')   ← task_type: RETRIEVAL_QUERY
    │  768-float vector
    ▼
supabase.rpc('match_chunks', {
  query_embedding: vector,
  part_filter: userPart,     ← only chunks from files accessible to this user's part
  match_count: 20
})
    │  Top 20 chunks by cosine similarity (HNSW index)
    ▼
rerankChunks(query, chunks, rerankModel)
    │
    ├── if chunks.length <= 5: return as-is
    └── else: LLM call with query + chunk summaries/texts
              Returns JSON array of indices: [3, 0, 7, 12, 1]
              Picks top 5 in relevance order
    │
    ▼
Top 5 chunks passed to LLM as context
```

### Why embed the enriched text instead of raw chunk text?

When a document is uploaded, what gets embedded is `summary + keywords + hypothetical_questions` — not the raw text. This is the **HyDE (Hypothetical Document Embedding)** pattern.

When a query arrives, the query itself gets embedded. The query embedding and the enriched-chunk embedding are compared. Because both the enriched chunk and the query are expressed in terms of *meaning and intent* rather than exact words, semantic matches that would be missed by keyword search are captured.

**Example:**  
A chunk about "Q3 revenue targets" might have a hypothetical question: *"What were the financial goals set for Q3?"*  
A user query: *"What financial goals were agreed upon?"*  
These match semantically even though they share no exact words.

### Cosine similarity

The `<=>` operator in pgvector computes cosine distance. Similarity = `1 - (embedding <=> query_embedding)`. Higher is better. The HNSW index makes this an approximate search — fast (milliseconds), with near-perfect recall on typical knowledge base sizes.

### Reranker

The reranker is an LLM (same model as chat) that receives the query and the top 20 chunk summaries+text snippets and returns a JSON array of the top 5 indices in relevance order. This catches cases where cosine similarity ranks a chunk high (similar words) but the LLM judges it low relevance to the actual query intent.

---

## 8. Knowledge Hub — Graph Search

**Triggered by:** Query router deciding `search_type: "graph"`.  
**File:** `lib/graphExtract.js` → `routeQuery`, `graphSearch`

### Query Router

Before every chatbot query (document mode), an LLM call decides whether to use vector or graph search:

```
System prompt: "Use graph when the query asks about everything related to
a topic/person/technology across documents. Use vector for focused factual
questions about specific content."

Returns JSON: {
  "search_type": "vector" | "graph",
  "reason": "...",
  "entities": { "topics": [], "technologies": [], "people": [], "projects": [] }
}
```

**Graph is chosen for:** "Find all documents related to Project X", "What do we know about Kubernetes?", "Everything Arjun worked on"  
**Vector is chosen for:** "What did the Q3 report say about budget?", "Summarise the data privacy policy"

### Graph Search Flow

```
routeQuery(query) → { search_type: 'graph', entities: { topics, technologies, people, projects } }
    │
    ▼
graphSearch({ entities, partFilter })
    │
    ├── Topics query (direct):
    │     MATCH (d:Document)-[:COVERS]->(t:Topic)
    │     WHERE t.name IN $topics
    │     RETURN DISTINCT d.id
    │
    ├── Topics query (one hop via RELATED_TO):
    │     MATCH (d:Document)-[:COVERS]->(t1:Topic)-[:RELATED_TO]-(t2:Topic)
    │     WHERE t2.name IN $topics
    │     RETURN DISTINCT d.id
    │     (finds documents about *related* topics even if not exact match)
    │
    ├── Technologies: MATCH (d)-[:MENTIONS_TECH]->(t:Technology)
    ├── People: MATCH (d)-[:MENTIONS_PERSON]->(p:Person)
    └── Projects: MATCH (d)-[:PART_OF]->(p:Project)
    │
    │  Union of all matched file IDs (Set)
    ▼
supabase.from('chunks')
  .select('chunk_text, chunk_index, file_id, files!inner(filename, file_url, filetype, accessible_to)')
  .in('file_id', [...fileIds])
  .order('chunk_index')        ← document reading order, not relevance
  .limit(20)
    │
    ▼
Apply partFilter on accessible_to
    │
    ▼
Return chunks (same shape as vector search output)
```

**Key differences from vector search:**
- No embedding of the query — Neo4j is searched by entity name matching
- Chunks returned in document order (chunk_index), not relevance order
- No reranking step (graph results go directly to the LLM)
- If graph returns 0 results → automatic fallback to vector search

### Neo4j data model

```
(Document)-[:COVERS]->(Topic)
(Document)-[:MENTIONS_TECH]->(Technology)
(Document)-[:MENTIONS_PERSON]->(Person)
(Document)-[:PART_OF]->(Project)
(Document)-[:RECORDS]->(Decision)
(Topic)-[:RELATED_TO]-(Topic)          ← co-occurrence edges
```

Neo4j stores *only* document metadata and entity relationships. Actual chunk text lives exclusively in PostgreSQL.

---

## 9. Insights Chatbot

**Entry points:** `POST /api/chat` (single response), `POST /api/chat/stream` (SSE stream)  
**File:** `server.js`

### Modes

The chatbot has two modes, determined by the `include_chatroom` flag in the request body:

**Document mode (default):**
- Runs `routeQuery` → vector or graph search
- System prompt (`CHAT_SYSTEM`): instructs the LLM to cite source filenames and answer only from context

**Chatroom mode (`include_chatroom: true`):**
- Calls `getChatroomContext(query)` instead of document search
- System prompt (`CHAT_SYSTEM_CHATROOM`): instructs LLM to answer only from chatroom messages, not general knowledge

### Single-turn flow (`POST /api/chat`)

```
Request: { query, user_id, model?, include_chatroom? }
    │
    ├── Validate user + load user record
    ├── Determine partFilter from user.part
    │
    ├── [Document mode]
    │     routeQuery(query) → { search_type, entities }
    │     if graph: chunks = await graphSearch({ entities, partFilter })
    │               if chunks.length === 0: fallback to vector
    │     if vector: embed query → match_chunks RPC → rerankChunks → top 5
    │
    ├── [Chatroom mode]
    │     getChatroomContext(query) → raw messages (last 7 days) + relevant historical chunks
    │
    ├── Build context string from chunks
    ├── generateChat({ model, system, messages })
    └── Return { answer, chunks_used, search_type, route_reason }
```

### Streaming flow (`POST /api/chat/stream`)

Same logic but uses SSE (Server-Sent Events). The response is chunked as `data: <token>\n\n` and the frontend assembles them. Uses `generateChatStream` (Gemini native streaming) or `generateChatGemmaStream` / `generateChatGLMStream` (Vertex MaaS OpenAI-compat streaming) depending on selected model.

### System prompts

**`CHAT_SYSTEM` (document mode):**
> "You are an intelligent knowledge assistant. Answer using only the context below. Cite source filenames. If the answer is not in the context, say so."

**`CHAT_SYSTEM_CHATROOM` (chatroom mode):**
> "You are an intelligent assistant with access to executive chatroom conversations. Answer using only the chatroom messages provided. If the answer is not in the context, say 'I could not find this in the chatroom history.'"

### Model selection

The `model` field in the request can be:
- `gemini-2.5-flash` → `generateChat` / `generateChatStream`
- `gemma` → `generateChatGemma` / `generateChatGemmaStream`
- `glm` → `generateChatGLM` / `generateChatGLMStream`
- `gpt-oss` → `generateChatGPTOSS` / `generateChatGPTOSSStream`

---

## 10. Executive Chatroom & Chatroom RAG

### Chatroom Messages

The executive chatroom is a private 1:1 and group messaging system for MD and Part Heads. Messages are stored in `chatroom_messages` with `sender_id`, `sender_name`, `content`, `conversation_id`, and `created_at`.

**Endpoints:**
- `GET /api/chatroom?user_id=X&with=Y` — fetch messages for a conversation between X and Y
- `POST /api/chatroom` — send a message
- `DELETE /api/chatroom/:id` — delete a message

### Nightly Chunk Processing (`processDayChatroom`)

**Scheduled:** Runs at 07:00 server local time daily, processing the *previous* day's messages.  
**Manual trigger:** `POST /api/admin/chatroom/process-chunks?date=YYYY-MM-DD`

```
Fetch all chatroom_messages for the target date
    │
    ▼
LLM call: partition messages into topical groups
  (returns JSON: [{ topic_summary, messages: [...] }])
    │
    ▼
For each topical group:
    ├── Concatenate messages into chunk_text
    ├── embedText(chunk_text, embeddingModel, 'document')
    └── Insert into chatroom_chunks:
          { chunk_text, topic_summary, embedding, processed_date }
```

The `chatroom_chunks` table has its own HNSW index and its own RPC (`match_chatroom_chunks`) — no date filter, searches across all processed dates.

### `getChatroomContext(query)`

Called when `include_chatroom: true`. Returns a string combining two sources:

**Part 1 — Recent raw messages (last 7 days):**
```javascript
supabase.from('chatroom_messages')
  .select('sender_name, content, created_at')
  .gte('created_at', since.toISOString())   // 7 days ago
  .order('created_at', { ascending: true })
  .limit(150)
```
Formatted as: `[DD/MM/YY, HH:MM] SenderName: message content`

**Part 2 — Historical semantic chunks (if query provided):**
```javascript
embedText(query.slice(0, 2000), embeddingModel, 'query')
supabase.rpc('match_chatroom_chunks', { query_embedding, match_count: 5 })
```
Returns top 5 most relevant processed chunks from any date. No date filter.

The two parts are joined and passed as context to the chatbot.

**Why 7 days for raw messages?**  
The original implementation used UTC midnight as the filter — messages sent before 05:30 UTC (i.e., any IST message sent before 11:00 AM) were being missed. The fix widened the window to 7 days to ensure all recent messages appear regardless of timezone.

---

## 11. AI Document Studio — Report Generator

**Endpoints:**
- `POST /api/report/generate` — generate from pasted text input
- `POST /api/report/generate-from-files` — generate from Knowledge Hub files (selected by file_ids) or chatroom context
- `POST /api/report-templates/:id/generate` — generate using a saved template structure
- `POST /api/report-templates/:id/generate-from-files` — template + file selection

### Core Generation Flow

```
Input: { input_data (text), instruction, output_format, user_id, include_chatroom? }
    │
    ├── [If include_chatroom]:
    │     chatroomText = getChatroomContext()
    │     if chatroomText: prepend to input_data
    │     if empty:        use original input_data unchanged
    │
    ├── Build system prompt with formatting rules:
    │     PDF mode: narrative text, paragraphs, full visual hierarchy
    │     Excel mode: maximize tables, structured data over prose
    │
    ├── LLM call (generateText, model: summarisation, maxTokens: 16000)
    │     Produces HTML report content
    │
    ├── Agent Review (optional):
    │     Second LLM call critiques the output for completeness/accuracy
    │     → revises and returns improved HTML
    │
    └── Export:
          PDF: htmlToPdf (Puppeteer + Chromium)
          Excel: custom HTML table parser → SheetJS workbook → XLSX buffer
          Response: binary file download
```

### `generate-from-files`

Accepts `file_ids[]` from the Knowledge Hub. For each file, retrieves all chunks from Supabase, concatenates them into a single document string, and passes to the report LLM. This gives the LLM the full content of selected documents as source material.

### Agent Review

After the initial generation, a second LLM pass is optionally run with a "critic" system prompt that checks for: missing sections, factual inconsistencies with the source, incomplete tables, and structural quality. The critic can rewrite sections and return an improved version.

### Export formats

**PDF:** `lib/htmlToPdf.js` — launches headless Chromium via Puppeteer, loads the HTML, and calls `page.pdf()` with A4 dimensions and 15mm margins.

**DOCX:** `lib/htmlToDocx.js` — uses `html-to-docx` to convert HTML to a Word-compatible DOCX buffer.

**Excel:** Custom logic in `server.js` — parses HTML `<table>` elements using regex, converts to SheetJS worksheet format, creates an XLSX workbook.

---

## 12. AI Document Studio — Refiner

**Endpoints:**
- `POST /api/refine` — analyse a document and return suggestions
- `POST /api/refine/:id/save` — save the refined version (replaces file content + re-indexes)

### Refiner Flow

```
Request: { file_id, user_id }
    │
    ├── Load file + all chunks from Supabase
    ├── Reconstruct full document text from chunks (ordered by chunk_index)
    │
    ├── LLM call with "smart suggestions" system prompt:
    │     - Identify grammar errors
    │     - Flag unclear/wordy phrasing
    │     - Suggest restructuring
    │     Returns JSON: { suggestions: [{type, original, suggested, reason}] }
    │
    └── Return suggestions to frontend for user review
```

### Save Refined Version

When the user accepts suggestions and saves:
1. The updated document text is used to regenerate chunks
2. Old chunks for this `file_id` are deleted from `chunks`
3. New chunks are enriched, embedded, and inserted (same pipeline as upload Step 5)
4. `files` row is updated: `version++`, `updated_by`, `updated_at`
5. Neo4j graph is updated: old document node replaced with new entity extraction

This means the Knowledge Hub always reflects the latest version without requiring a separate re-upload.

---

## 13. AI-Transcribed Minutes of Meeting

**Endpoints:**
- `POST /api/mom/transcribe` — process audio or raw text into structured MoM
- `POST /api/mom/save` — persist to `minutes` table
- `GET /api/mom` — list saved MoMs (filtered by `accessible_to`)
- `POST /api/mom/:id/export-to-hub` — push MoM as a document into the Knowledge Hub

### Transcription Flow

```
Input: { transcript (text), title?, user_id, accessible_to }
    │
    ├── LLM call (MoM extraction prompt):
    │     System: "Extract structured MoM fields from this transcript"
    │     Returns JSON:
    │     {
    │       title: "...",
    │       summary: "...",
    │       attendees: ["name1", "name2"],
    │       decisions: ["decision1", "decision2"],
    │       action_items: [{ text, owner, due }]
    │     }
    │
    └── Return structured MoM to frontend for review
```

### Export to Hub

When the user clicks "Export to Knowledge Hub":
1. The MoM is serialised to formatted text (title + attendees + decisions + action items)
2. Passed through the full upload pipeline (chunk → enrich → embed → graph index)
3. Stored in `files` with the MoM's `accessible_to` scope
4. The action items from the MoM are also written to `action_items` table with `source_type: 'mom'`

---

## 14. Action Item Tracker

**Endpoints:**
- `GET /api/action-items` — list all (filtered by accessible_to)
- `POST /api/action-items` — create manually
- `PATCH /api/action-items/:id` — update items array (complete, assign)
- `DELETE /api/action-items/:id` — delete
- `POST /api/action-items/extract` — extract from a document (LLM call)

### Extraction Logic (`lib/actionItems.js`)

```
Input: document text (truncated to 16,000 chars)
    │
    ├── LLM call with EXTRACTION_PROMPT:
    │     Looks for: assigned tasks, action verbs, open items, pending approvals
    │     Returns JSON array of strings:
    │     ["Review Q3 budget and share feedback by Friday", ...]
    │
    └── Each string wrapped in { id: uuid, text, completed: false }
```

### Storage

Each record in `action_items` has:
- `file_id` / `source_id` — which document or MoM it came from
- `source_type` — `'file'` or `'mom'`
- `items` — JSONB array of `{ id, text, completed, assignees: [user_id] }`
- `accessible_to` — inherits from the source document

Individual items within the array can be marked complete, assigned to users, or given sub-tasks without replacing the whole record.

---

## 15. Intelligence Feed (Tech Sensing)

**Entry point:** `POST /api/feed/refresh`  
**File:** `lib/feed.js`

This feature automatically fetches, filters, scores, and caches industry news per department.

### Source configuration (`config.json`)

Each source has:
```json
{
  "name": "TechCrunch AI",
  "url": "https://techcrunch.com/...",
  "rss": "https://techcrunch.com/.../feed/",
  "parts": ["Tech Management", "PRISM"]
}
```
Sources with `"geminiSearch": true` use Gemini grounded search instead of RSS (for sites without public feeds or behind Cloudflare).

### Pipeline per source

```
For each source in config.sources (filtered by requested part):
    │
    ├── [RSS source]:
    │     rssParser.parseURL(rssUrl)                    ← rss-parser library
    │     if fails: fetchRssRaw() → sanitizeXml() → rssParser.parseString()
    │     if fails: scrapeViaGeminiSearch()             ← Gemini + Google Search grounding
    │
    ├── [geminiSearch source]:
    │     Gemini call with Google Search tool
    │     Extract article URLs from grounding chunks or JSON response
    │
    ├── Apply part-specific filter:
    │     PMO: filterArticleForPMO(title) → keep only AI-in-PM articles
    │     Tech Management: filterArticleForTechSensing(title) → keep only technical articles
    │     PRISM: tagArticleRelevance(title) → assign High/Medium/Low worklet relevance
    │
    └── Collect into grouped result object
```

### Filtering (LLM-based)

Each filter/scorer is a separate LLM call with a targeted system prompt:

- **PMO filter:** Keeps articles about AI applied to project management, agile, planning. Discards generic PM advice.
- **Tech Sensing filter:** Keeps technical content (new models, tools, research). Discards business/consumer news.
- **PRISM worklet tagger:** Assigns `High` / `Medium` / `Low` based on whether an article could inspire a 3-5 day hands-on engineering task.

All three have 3-attempt retry logic with exponential backoff (1s, 2s, 3s). On persistent failure, articles are kept (fail-open policy).

### Caching

Results are stored as a single JSON blob in `feed_cache` (one row, id='latest'). Subsequent `GET /api/feed?part=X` reads from cache, not the live sources. Cache is invalidated only when `POST /api/feed/refresh` is explicitly called.

### Live Search

`POST /api/feed/live-search` accepts a free-text query and uses `generateTextWithSearch` (Gemini with Google Search grounding) to return real-time web results beyond the curated feed.

### Open Source LLM Leaderboard

`GET /api/feed/leaderboard` fetches live LLM rankings from an external leaderboard API (configurable endpoint). Returns tier rankings of current open-source models.

---

## 16. AI Literacy Quizzes

**Endpoints:**
- `GET /api/quiz` — fetch quiz questions
- `POST /api/quiz/score` — submit score (upserts by user_id)
- `GET /api/quiz/leaderboard` — top scores across the org

### Score storage

```sql
quiz_scores (
  user_id TEXT PRIMARY KEY,   -- only one record per user
  user_name TEXT,
  quiz_id TEXT,               -- allows multiple quiz types
  score INTEGER,
  total INTEGER,
  attempted_at TIMESTAMPTZ
)
```

Retaking a quiz does an UPSERT — the new score replaces the old one. The leaderboard is ordered by `score DESC, attempted_at ASC` (ties broken by who scored first).

---

## 17. Task Forces

Cross-departmental working groups with their own feed, action items, and member management.

**Key tables:** `task_forces`, `tf_updates`, `tf_action_items`

**Visibility rules:**
- Members see only task forces they belong to
- Part Heads see all task forces within their part
- MD sees all task forces

**Endpoints:**
- `GET /api/task-forces` — list (filtered by user role)
- `POST /api/task-forces` — create
- `PATCH /api/task-forces/:id` — update name/status/members
- `POST /api/task-forces/:id/updates` — post a status update / milestone / decision
- `POST /api/task-forces/:id/action-items` — add an action item
- `PATCH /api/task-forces/:id/action-items/:aid` — mark done / update

---

## 18. Report Templates

Templates are uploaded documents that define the structure a generated report should follow. The template text is extracted and stored separately from the Knowledge Hub.

**Flow:**
1. Upload template → `POST /api/report-templates` → extract text → store in `report_templates`
2. Select template + source files → `POST /api/report-templates/:id/generate-from-files`
3. The LLM receives: template structure + source document content + user instruction
4. Output conforms to the template format

---

## 19. RAG Evaluation

**Endpoints:**
- `POST /api/chat/evaluate` — evaluate a single Q&A pair
- `GET /api/chat/eval-summary` — get rolling averages

After a chatbot response, the frontend can optionally submit the query + answer for quality scoring. Three metrics are computed by an LLM judge:

| Metric | What it measures |
|---|---|
| `context_precision` | Were the retrieved chunks actually relevant to the query? |
| `faithfulness` | Is the answer supported by the context, or did the LLM hallucinate? |
| `response_relevance` | Does the answer actually address the question asked? |

Each metric is a float 0–1. Results are stored in `rag_evaluations` and the rolling averages are maintained in `rag_eval_summary` (single-row upsert after each evaluation).

---

## 20. API Endpoint Reference

### Files / Knowledge Hub
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/files/upload` | Upload a document |
| `GET` | `/api/files` | List files (filtered by user's part) |
| `DELETE` | `/api/files/:id` | Delete file + chunks + graph nodes |
| `POST` | `/api/files/:id/lock` | Lock file for editing |
| `POST` | `/api/files/:id/unlock` | Release lock |
| `POST` | `/api/files/:id/replace` | Upload a new version |
| `POST` | `/api/files/match` | Full-text search in filenames |

### Chatbot
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Single-turn RAG answer |
| `POST` | `/api/chat/stream` | Streaming RAG answer (SSE) |
| `POST` | `/api/chat/route` | Debug: see how a query would be routed |
| `POST` | `/api/chat/evaluate` | Submit Q&A for RAG quality scoring |
| `GET` | `/api/chat/eval-summary` | Get RAG metric averages |

### Reports
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/report/generate` | Generate from pasted text |
| `POST` | `/api/report/generate-from-files` | Generate from selected Knowledge Hub files |
| `GET` | `/api/report-templates` | List templates |
| `POST` | `/api/report-templates` | Upload a template |
| `DELETE` | `/api/report-templates/:id` | Delete template |
| `POST` | `/api/report-templates/:id/generate` | Generate from template + text |
| `POST` | `/api/report-templates/:id/generate-from-files` | Generate from template + files |

### Refiner
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/refine` | Analyse document + return suggestions |
| `POST` | `/api/refine/:id/save` | Save refined version + re-index |

### Feed
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/feed` | Get cached feed for a part |
| `POST` | `/api/feed/refresh` | Re-run pipeline for a part |
| `GET` | `/api/feed/sources` | List configured sources |
| `POST` | `/api/feed/sources` | Add/update a source |
| `POST` | `/api/feed/live-search` | On-demand Gemini web search |
| `GET` | `/api/feed/leaderboard` | Live open-source LLM rankings |

### MoM, Action Items, Task Forces
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/mom/transcribe` | Process transcript → structured MoM |
| `POST` | `/api/mom/save` | Save MoM |
| `GET` | `/api/mom` | List saved MoMs |
| `POST` | `/api/mom/:id/export-to-hub` | Push MoM into Knowledge Hub |
| `GET` | `/api/action-items` | List action items |
| `POST` | `/api/action-items/extract` | Extract from document text |
| `PATCH` | `/api/action-items/:id` | Update items |
| `GET` | `/api/task-forces` | List task forces |
| `POST` | `/api/task-forces` | Create task force |
| `PATCH` | `/api/task-forces/:id` | Update task force |
| `POST` | `/api/task-forces/:id/updates` | Post update |
| `POST` | `/api/task-forces/:id/action-items` | Add action item |

### Chatroom
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/chatroom` | Fetch conversation messages |
| `POST` | `/api/chatroom` | Send message |
| `DELETE` | `/api/chatroom/:id` | Delete message |
| `POST` | `/api/admin/chatroom/process-chunks` | Manually trigger nightly chunk job |

### Quizzes & Users
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/quiz` | Get quiz questions |
| `POST` | `/api/quiz/score` | Submit score |
| `GET` | `/api/quiz/leaderboard` | Get leaderboard |
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create user |

---

## 21. Configuration Reference (`config.json`)

```json
{
  "sources": [...],              // RSS/search sources per part
  "maxItemsPerSource": 5,        // default article limit per source per refresh
  "maxItemsPerSourceByPart": {   // override limits by part
    "MD": 3,
    "PMO": 10
  },
  "parts": [...],                // valid part names
  "models": {
    "scoring": "gemini-2.5-flash",        // feed filtering + worklet tagging
    "summarisation": "gemini-2.5-flash",  // report generation
    "enrichment": "gemini-2.5-flash",     // chunk enrichment on upload
    "reranker": "gemini-2.5-flash",       // RAG reranking
    "chat": "gemini-2.5-flash"            // chatbot + routing + entity extraction
  },
  "embeddingModel": "text-embedding-004",
  "embeddingDimensions": 768,
  "rag": {
    "vector_search_top_k": 20,   // how many chunks to retrieve before reranking
    "rerank_top_n": 5,           // how many chunks to keep after reranking
    "chunk_min_words": 300,      // minimum words per chunk
    "chunk_max_words": 600       // maximum words per chunk
  }
}
```

---

## 22. Alternative Codebase Stack

A parallel implementation of the same platform exists with a different infrastructure stack, intended for fully local/on-premise deployment.

| Component | Cloud version (this repo) | Local/on-premise version |
|---|---|---|
| LLM | Gemini 2.5 Flash (Vertex AI) | Qwen 3.5 27B (Q4_K_M) via Ollama |
| Embedding model | `text-embedding-004` (768-dim, Google) | `qwen3-embedding:0.6b` (via Ollama) |
| Vector store | Supabase PostgreSQL + pgvector | PostgreSQL (self-hosted) + ChromaDB |
| Graph DB | Neo4j (AuraDB or self-hosted) | Neo4j (same) |
| File storage | Supabase Storage | Local filesystem or MinIO |
| Auth | Supabase service key | Custom or none |

### Key differences for engineers working on the local stack

**ChromaDB instead of pgvector:**
- ChromaDB is a dedicated vector database (Python-native, with a JS client)
- No SQL `match_chunks` RPC — use the ChromaDB collection's `.query()` method with `n_results: 20`
- The embedding must be generated first (same process), then passed to ChromaDB

**`qwen3-embedding:0.6b` instead of `text-embedding-004`:**
- Served locally via Ollama on the same machine as the LLM
- Endpoint: `POST http://localhost:11434/api/embeddings` with `{ model: "qwen3-embedding:0.6b", prompt: "..." }`
- Output dimension may differ from 768 — verify the actual dimension and update the ChromaDB collection schema and PostgreSQL vector column size accordingly
- Task type distinction (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`) does not apply — Ollama embedding models do not support task types

**Qwen 3.5 27B via Ollama:**
- Single-user sequential inference — no concurrent request handling
- Endpoint: `POST http://localhost:11434/api/chat` (OpenAI-compat: `POST http://localhost:11434/v1/chat/completions`)
- All LLM calls in `lib/llm.js` need to be pointed at the Ollama endpoint
- Context window: 256K tokens (Q4_K_M quantization), but realizable context is ~83,000 tokens given the 48GB VRAM budget

**What stays the same:**
- Neo4j graph schema and all Cypher queries are identical
- Chunking logic (`lib/chunk.js`) is identical
- Enrichment, reranking, and routing prompt logic is identical
- All API routes and business logic in `server.js` are identical — only the `lib/llm.js` and `lib/rag.js` clients change
