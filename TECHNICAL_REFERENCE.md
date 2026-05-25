# KERNEL — Technical Reference Document

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack](#2-tech-stack)
3. [Environment Variables](#3-environment-variables)
4. [Database Schema](#4-database-schema)
5. [Document Upload Pipeline](#5-document-upload-pipeline)
6. [Knowledge Hub — Vector Search](#6-knowledge-hub--vector-search)
7. [Knowledge Hub — Graph Search](#7-knowledge-hub--graph-search)
8. [Insights Chatbot](#8-insights-chatbot)
9. [Executive Chatroom & Chatroom RAG](#9-executive-chatroom--chatroom-rag)
10. [AI Document Studio — Report Generator](#10-ai-document-studio--report-generator)
11. [AI Document Studio — Refiner](#11-ai-document-studio--refiner)
12. [AI-Transcribed Minutes of Meeting](#12-ai-transcribed-minutes-of-meeting)
13. [Action Item Tracker](#13-action-item-tracker)
14. [Intelligence Feed (Tech Sensing)](#14-intelligence-feed-tech-sensing)
15. [AI Literacy Quizzes](#15-ai-literacy-quizzes)
16. [Task Forces](#16-task-forces)
17. [Report Templates](#17-report-templates)
18. [RAG Evaluation](#18-rag-evaluation)
19. [API Endpoint Reference](#19-api-endpoint-reference)
20. [Alternative Cloud Stack](#20-alternative-cloud-stack)

---

## 1. System Overview

KERNEL is a unified AI platform built for the R&D Strategy Group (RSG) at Samsung Research. It eliminates fragmented knowledge, manual workflows, and isolated tooling across four internal teams: **Tech Management, PRISM, PMO, and Data Management**.

The platform is a **FastAPI (Python) backend** with a React frontend (Vite). The backend serves all API routes; in production the built React static files are served separately or via a reverse proxy.

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

## 2. Tech Stack

### Backend
| Layer | Technology | Library / Tool |
|---|---|---|
| Server | FastAPI (Python) | `fastapi`, `uvicorn` |
| File uploads | FastAPI `UploadFile` | built-in |
| LLM | Qwen 3.5 9B (Q4_K_M) via Ollama | `ollama` Python client or raw HTTP (`requests`) |
| Embeddings | `qwen3-embedding:0.6b` via Ollama | `ollama` Python client or raw HTTP |
| Vector DB | ChromaDB (local persistent) | `chromadb` |
| Relational DB | PostgreSQL (self-hosted, direct connection) | `psycopg2` |
| Graph DB | Neo4j (self-hosted or AuraDB) | `neo4j` Python driver |


### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build tool | Vite |
| HTTP client | Native fetch |

### Models

| Role | Model | Served via |
|---|---|---|
| LLM — all tasks (chat, routing, enrichment, summarisation, scoring, reranking) | Qwen 3.5 9B (Q4_K_M) | Ollama (local) |
| Embeddings | `qwen3-embedding:0.6b` | Ollama (local) |

---

## 3. Environment Variables

```
DB_HOST     PostgreSQL host (default: localhost)
DB_PORT     PostgreSQL port
DB_NAME     Database name
DB_USER     PostgreSQL user
DB_PASSWORD PostgreSQL password

#LLM
OLLAMA_BASE_URL
OLLAMA_MODEL

#Embedding model
OLLAMA_EMBED_URL
OLLAMA_EMBED_MODEL
OLLAMA_EMBED_DIMENSIONS



NEO4J_URI            bolt:// or neo4j+s:// URI
NEO4J_USER           Neo4j username
NEO4J_PASSWORD       Neo4j password


```


---

## 4. Database Schema

All relational tables live in **PostgreSQL**. The full DDL is in `postgres-local-setup.sql`. Vector embeddings are stored separately in **ChromaDB** — the `chunks` and `chatroom_chunks` tables contain only text and metadata; there is **no vector column** in PostgreSQL.

### Setup

```bash
psql -U postgres -c "CREATE DATABASE projectdb;"
psql -U postgres -d projectdb -f postgres-local-setup.sql
```

The setup script enables the `pgcrypto` extension for `gen_random_uuid()`.

---

### Core tables

#### `files`
Stores metadata for every uploaded document.
```
id              uuid PK
filename        text
filetype        text          (file extension only, e.g. pdf, docx)
file_url        text          (local filesystem path or URL)
uploaded_by     text          (user name (e.g. Arjun Mehta))
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
Stores every text chunk from every uploaded document. **No embedding column** — embeddings live in ChromaDB.
```
id                     uuid PK
file_id                uuid FK → files(id) ON DELETE CASCADE
chunk_text             text          ← the actual 300-600 word passage
chunk_summary          text          ← LLM-generated 2-3 sentence summary
keywords               text[]        ← 5-8 LLM-extracted keywords
hypothetical_questions text[]        ← 3-5 questions this chunk would answer
chunk_index            integer       ← position within the source document
created_at             timestamptz
```

The `chunk_id` (UUID) is used as the document ID in ChromaDB to link the two stores. When a vector search returns ChromaDB results, the IDs are used to fetch the full `chunk_text` and metadata from PostgreSQL.

#### `files` + `chunks` relationship
One file → many chunks (cascade delete). When a file is deleted or replaced, all its chunks are automatically removed from PostgreSQL. ChromaDB entries must be deleted separately using the same chunk UUIDs.

---

### ChromaDB collections

ChromaDB stores the actual vector embeddings. Two collections are maintained:

**`kernel_chunks`** (document chunks)
```
document id     = chunk.id (UUID from PostgreSQL chunks table)
embedding       = qwen3-embedding:0.6b output on enriched text
metadata        = { file_id, chunk_index, filename, 	accessible_to_str (pipe-delimited string), filetype }
document        = raw chunk_text (summary + keywords + hypothetical_questions)
```

**`kernel_chatroom_chunks`** (chatroom segments)
```
document id     = chatroom_chunk.id (UUID from PostgreSQL chatroom_chunks table)
embedding       = qwen3-embedding:0.6b output on chunk_text
metadata        = { processed_date, topic_summary }
document        = chunk_text
```

Part-scoped access filtering is applied in Python after ChromaDB returns results by checking `metadata.accessible_to`.

---

### Other tables

| Table | Purpose |
|---|---|
| `users` | Org members with role (`MD`, `PartHead`, `Member`, `TeamHead`), part, and team |
| `feed_cache` | Single-row JSON cache for the latest Intelligence Feed run per part |
| `action_items` | Per-document/MoM action item lists (JSONB array of `{id, text, completed, assignees, due_date, parent_item_id, source_type,source_id}`) |
| `minutes` | Saved MoM records (title, summary, attendees, decisions, action_items, transcript) |
| `quiz_scores` | Latest quiz score per user (`user_id` PK — retaking overwrites) |
| `report_templates` | Uploaded templates with extracted text for report generation |
| `task_forces` | Cross-team working groups with owners, members, parts, teams |
| `tf_updates` | Feed of status updates/milestones/decisions per task force |
| `tf_action_items` | Action items scoped to a task force (assignee, due date, done flag) |
| `chatroom_messages` | Executive chatroom messages (sender, content, conversation_id) |
| `chatroom_chunks` | Nightly AI-partitioned topical segments of chatroom messages (text + metadata only, no embedding) |
| `email_tokens` | OAuth refresh tokens |
| `rag_evaluations` | Per-query RAG quality scores (precision, faithfulness, relevance) |
| `rag_eval_summary` | Rolling averages of RAG evaluation metrics |

### PostgreSQL functions

**`update_rag_eval_summary(context_precision, faithfulness, response_relevance)`**  
A `plpgsql` function that maintains a running average of RAG evaluation scores using an incremental formula. Called after every evaluation submission — avoids re-scanning the full `rag_evaluations` table to recompute averages.

---

## 5. Document Upload Pipeline

**Entry point:** `POST /api/files/upload`

This is the most complex pipeline in the system. When a user uploads a document, six sequential steps execute:

### Step 1 — Text Extraction

The uploaded file buffer is dispatched by file type:

| Format | Parser | Notes |
|---|---|---|
| PDF | `PyMuPDF` | 
| DOCX | `python-docx` |
| PPTX | `python-pptx` |
| XLSX | `openpyxl` |
| TXT | Raw UTF-8 decode | |

Returns: `{ text: str, headings: list[{line, level, text}], slides?: list[str], error?: str }`

**Heading detection (PDF/DOCX):** Four heuristics checked in order — Markdown `#` style, numbered sections (`1.`, `2.1`), short ALL-CAPS lines, short Title Case lines followed by a blank line.

### Step 2 — Chunking

`chunk_document(extracted, chunk_min_words=300, chunk_max_words=600)` dispatches on document type:

- **PPTX:** One chunk per slide
- **PDF/DOCX with ≥2 detected headings:** `chunk_by_headings` — splits on section boundaries, sub-splits oversized sections, merges undersized consecutive sections until each chunk reaches the minimum word count
- **Everything else:** `chunk_by_paragraphs` — accumulates paragraphs into a buffer, flushes when adding the next paragraph would exceed the max

Then `add_context_prefix` prepends the nearest heading ([Section: {heading}]\n...) to every chunk so the LLM has structural context even for isolated passages.

### Step 3 — Local File Storage

The original file buffer is saved to the local filesystem under fastapi_backend/uploads/. A UUID prefix is added to the filename to avoid collisions. The resulting URL (http://localhost:{PORT}/uploads/{uuid}-{filename}) is stored in files.file_url.

### Step 4 — `files` Row Insert

A row is inserted into the `files` PostgreSQL table with metadata: filename, filetype, file_url, uploaded_by, accessible_to (the parts/roles array), version.

### Step 5 — Per-chunk: Enrich → Embed → Store

For each chunk, three sub-steps run sequentially:

**5a. Enrichment (LLM call)**  
A call to Qwen 3.5 9B via Ollama generates:
```json
{
  "summary": "2-3 sentence summary of this chunk",
  "keywords": ["keyword1", "keyword2", ...],
  "hypothetical_questions": ["Q a user might ask?", ...]
}
```
This is the **Hypothetical Document Embedding (HyDE)** pattern — instead of embedding the raw chunk text directly, we embed a richer representation of what the chunk *means*.

**5b. Build embedding input**  
Concatenates: `summary + "\n" + keywords joined by ", " + "\n" + hypothetical_questions joined by " "`.  
If enrichment failed, falls back to raw `chunk_text[:2000]`.

**5c. Embedding (Ollama)**  
Calls the local Ollama embedding endpoint:

Returns a float array. The dimension depends on the model — verify the exact output dimension and configure ChromaDB collection with the matching dimension on first creation.

**5d. Dual store**  
- **PostgreSQL `chunks`:** Stores `chunk_text`, `chunk_summary`, `keywords`, `hypothetical_questions`, `chunk_index`, `file_id` — everything *except* the embedding
- **ChromaDB `kernel_chunks`:** Stores the embedding vector, with `chunk_id` as the document ID and ` { file_id, chunk_index, filename, filetype, file_url, uploaded_by, accessible_to_str, chunk_summary, keywords_json, hypothetical_questions_json }` as metadata

### Step 6 — Graph Indexing (Neo4j)

Non-blocking — does not block the upload response. If Neo4j is configured:

1. `extract_entities(text)` sends the first 6,000 characters to Qwen 3.5 9B which returns structured JSON:
   ```json
   {
     "topics": ["cloud migration", "q3 planning"],
     "technologies": ["kubernetes", "react"],
     "people": ["Arjun Mehta"],
     "projects": ["Project X"],
     "decisions": ["decided to migrate to k8s"]
   }
   ```

2. `write_document_to_graph(...)` writes to Neo4j:
   - `MERGE (d:Document {id})` — upsert document node
   - Per topic: `MERGE (t:Topic {name})` + `(d)-[:COVERS]->(t)` — name is lowercased
   - Per technology: `MERGE (t:Technology {name})` + `(d)-[:MENTIONS_TECH]->(t)` — name is lowercased
   - Per person: `MERGE (p:Person {name})` + `(d)-[:MENTIONS_PERSON]->(p)`— name is lowercased
   - Per project: `MERGE (p:Project {name})` + `(d)-[:PART_OF]->(p)`— name is lowercased
   - Per decision: `MERGE (dec:Decision {text, documentId})` + `(d)-[:RECORDS]->(dec)`
   - **Topic co-occurrence edges:** `(t1)-[:RELATED_TO]-(t2)` for every pair of topics in the same document — enables one-hop graph traversal during search

When a document is deleted, `delete_document_from_graph` runs `DETACH DELETE` on the Document node and any associated Decision nodes, removing all their relationships.

**Neo4j constraints (created at server startup):**
- `Document.id` UNIQUE
- `Topic.name` UNIQUE
- `Technology.name` UNIQUE
- `Person.name` UNIQUE
- `Project.name` UNIQUE

---

## 6. Knowledge Hub — Vector Search

**Triggered by:** Insights Chatbot queries routed to vector, or graph fallback.

### Full flow

```
User query
    │
    ▼
Ollama embedding: POST /api/embeddings
  model: qwen3-embedding:0.6b
  prompt: query text
    │  float array
    ▼
ChromaDB collection.query(
  query_embeddings=[vector],
  n_results=20,
  include=["documents", "metadatas", "distances"]
)
    │  Top 20 chunks by cosine similarity
    ▼
Filter results by accessible_to metadata
  (keep only chunks where metadata["accessible_to"] contains user's part)
    │
    ▼
Fetch full chunk_text + chunk_summary from PostgreSQL
  WHERE id IN [returned ChromaDB IDs]
    │
    ▼
rerank_chunks(query, chunks, llm_model)
    │
    ├── if chunks ≤ 5: return as-is
    └── else: LLM call with query + chunk summaries/texts
              Returns list of indices: [3, 0, 7, 12, 1]
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

### Cosine similarity in ChromaDB

ChromaDB computes cosine similarity natively. The `distances` returned are cosine distances — lower is more similar. When surfacing results to the LLM, similarity = `1 - distance`. ChromaDB uses an HNSW index internally for fast approximate nearest-neighbour search.

### Reranker

The reranker is an LLM call (Qwen 3.5 9B) that receives the query and the top 20 chunk summaries + text snippets and returns a JSON list of the top 5 indices in relevance order. This catches cases where cosine similarity ranks a chunk high (similar words) but the LLM judges it low relevance to the actual query intent.

---

## 7. Knowledge Hub — Graph Search

**Triggered by:** Query router deciding `search_type: "graph"`.

### Query Router

Before every chatbot query (document mode), an LLM call (Qwen 3.5 9B) decides whether to use vector or graph search:

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
route_query(query) → { search_type: 'graph', entities: { topics, technologies, people, projects } }
    │
    ▼
graph_search({ entities, part_filter })
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
    │  Union of all matched file IDs (set)
    ▼
PostgreSQL: SELECT chunk_text, chunk_index, file_id, filename, filetype, file_url
FROM chunks JOIN files ON chunks.file_id = files.id
WHERE file_id IN [matched IDs]
  AND [part_filter] = ANY(files.accessible_to)
ORDER BY chunk_index
LIMIT 20
    │
    ▼
Return chunks (same shape as vector search output)
```

**Key differences from vector search:**
- No embedding of the query — Neo4j is searched by entity name matching
- Chunks returned in document order (`chunk_index`), not relevance order
- No reranking step — graph results go directly to the LLM
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

## 8. Insights Chatbot

**Entry points:** `POST /api/chat` (single response), `POST /api/chat/stream` (SSE stream)

### Modes

The chatbot has two modes, determined by the `include_chatroom` flag in the request body:

**Document mode (default):**
- Runs `route_query` → vector or graph search
- System prompt (`CHAT_SYSTEM`): instructs the LLM to cite source filenames and answer only from context

**Chatroom mode (`include_chatroom: true`):**
- Calls `get_chatroom_context(query)` instead of document search
- System prompt (`CHAT_SYSTEM_CHATROOM`): instructs LLM to answer only from chatroom messages, not general knowledge

### Single-turn flow (`POST /api/chat`)

```
Request: { query, user_id, model?, include_chatroom? }
    │
    ├── Validate user + load user record from PostgreSQL
    ├── Determine part_filter from user.part
    │
    ├── [Document mode]
    │     route_query(query) → { search_type, entities }
    │     if graph: chunks = graph_search({ entities, part_filter })
    │               if len(chunks) == 0: fallback to vector
    │     if vector: embed query → ChromaDB query → rerank → top 5
    │
    ├── [Chatroom mode]
    │     get_chatroom_context(query) → raw messages (last 7 days) + relevant historical chunks
    │
    ├── Build context string from chunks
    ├── Ollama chat call: POST /api/chat with model=qwen3.5:9b-q4_k_m
    └── Return { answer, chunks_used, search_type, route_reason }
```

### Streaming flow (`POST /api/chat/stream`)

Same logic but uses SSE (Server-Sent Events). FastAPI's `StreamingResponse` yields tokens as `data: <token>\n\n`. The Ollama API supports streaming natively via `stream=True` in the chat call — tokens are yielded as they are generated and forwarded to the client.

### System prompts

**`CHAT_SYSTEM` (document mode):**
> "You are an intelligent knowledge assistant. Answer using only the context below. Cite source filenames. If the answer is not in the context, say so."

**`CHAT_SYSTEM_CHATROOM` (chatroom mode):**
> "You are an intelligent assistant with access to executive chatroom conversations. Answer using only the chatroom messages provided. If the answer is not in the context, say 'I could not find this in the chatroom history.'"

---

## 9. Executive Chatroom & Chatroom RAG

### Chatroom Messages

The executive chatroom is a private messaging system for MD and Part Heads. Messages are stored in `chatroom_messages` with `sender_id`, `sender_name`, `content`, `conversation_id`, and `created_at`.

**Endpoints:**
- `GET /api/chatroom?user_id=X&with=Y` — fetch messages for a conversation between X and Y
- `POST /api/chatroom` — send a message
- `DELETE /api/chatroom/:id` — delete a message

### Nightly Chunk Processing (`process_day_chatroom`)

**Scheduled:** Runs at 07:00 server local time daily, processing the *previous* day's messages.  
**Manual trigger:** `POST /api/admin/chatroom/process-chunks?date=YYYY-MM-DD`

```
Fetch all chatroom_messages for the target date from PostgreSQL
    │
    ▼
LLM call (Qwen 3.5 9B): partition messages into topical groups
  Returns JSON: [{ topic_summary, messages: [...] }]
    │
    ▼
For each topical group:
    ├── Concatenate messages into chunk_text
    ├── Ollama embedding: qwen3-embedding:0.6b on chunk_text
    ├── Insert into PostgreSQL chatroom_chunks:
    │     { chunk_text, topic_summary, processed_date }
    └── Insert into ChromaDB kernel_chatroom_chunks:
          { id: chunk_id, embedding: vector, metadata: { processed_date, topic_summary } }
```

The `chatroom_chunks` PostgreSQL table has no embedding column — embeddings live in ChromaDB `kernel_chatroom_chunks`. The two are linked by UUID.

### `get_chatroom_context(query)`

Called when `include_chatroom: True`. Returns a string combining two sources:

**Part 1 — Recent raw messages (last 7 days):**
```python
SELECT sender_name, content, created_at
FROM chatroom_messages
WHERE created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at ASC
LIMIT 150
```
Formatted as: `[DD/MM/YY, HH:MM] SenderName: message content`

**Part 2 — Historical semantic chunks (if query provided):**
```python
embed query → ChromaDB kernel_chatroom_chunks.query(n_results=5)
# No date filter — searches across all processed dates
```
Returns top 5 most relevant processed chunks from any date.

The two parts are joined and passed as context to the chatbot.

**Why 7 days for raw messages?**  
The original implementation used UTC midnight as the filter — messages sent before 05:30 UTC (i.e., any IST message sent before 11:00 AM) were being missed. The fix widened the window to 7 days to ensure all recent messages appear regardless of timezone.

---

## 10. AI Document Studio — Report Generator

**Endpoints:**
- `POST /api/report/generate` — generate from pasted text input
- `POST /api/report/generate-from-files` — generate from Knowledge Hub files (selected by file_ids) or chatroom context
- `POST /api/report-templates/{id}/generate` — generate using a saved template structure
- `POST /api/report-templates/{id}/generate-from-files` — template + file selection

### Core Generation Flow

```
Input: { input_data (text), instruction, output_format, user_id, include_chatroom? }
    │
    ├── [If include_chatroom]:
    │     chatroom_text = get_chatroom_context()
    │     if chatroom_text: prepend to input_data
    │     if empty:         use original input_data unchanged
    │
    ├── Build system prompt with formatting rules:
    │     PDF mode: narrative text, paragraphs, full visual hierarchy
    │     Excel mode: maximize tables, structured data over prose
    │
    ├── Qwen 3.5 9B call (max_tokens: 16000)
    │     Produces HTML report content
    │
    ├── Agent Review (optional second pass):
    │     Second LLM call critiques the output for completeness/accuracy
    │     → revises and returns improved HTML
    │
    └── Export:
          PDF: WeasyPrint (HTML → PDF)
          Excel: parse HTML tables → openpyxl workbook → XLSX bytes
          Response: binary file download
```

### `generate-from-files`

Accepts `file_ids[]` from the Knowledge Hub. For each file, retrieves all chunks from PostgreSQL ordered by `chunk_index`, concatenates them, and passes the full content to the report LLM as source material.

### Agent Review

After the initial generation, a second LLM pass is optionally run with a "critic" system prompt that checks for: missing sections, factual inconsistencies with the source, incomplete tables, and structural quality. The critic can rewrite sections and return an improved version.

### Export formats

**PDF:** WeasyPrint converts the generated HTML to PDF directly in Python — no headless browser required.  
**DOCX:** python-docx parses the HTML structure and builds a Word document.  
**Excel:** Custom logic parses HTML `<table>` elements, converts to openpyxl worksheet rows, creates an XLSX workbook.

---

## 11. AI Document Studio — Refiner

**Endpoints:**
- `POST /api/refine` — analyse a document and return suggestions
- `POST /api/refine/{id}/save` — save the refined version (replaces file content + re-indexes)

### Refiner Flow

```
Request: { file_id, user_id }
    │
    ├── Load file + all chunks from PostgreSQL (ordered by chunk_index)
    ├── Reconstruct full document text
    │
    ├── Qwen 3.5 9B call with "smart suggestions" prompt:
    │     Returns JSON: { suggestions: [{type, original, suggested, reason}] }
    │     Types: "grammar", "clarity", "structure", "paraphrase"
    │
    └── Return suggestions to frontend for user review
```

### Save Refined Version

When the user accepts suggestions and saves:
1. The updated document text is re-chunked
2. Old chunks for this `file_id` are deleted from PostgreSQL `chunks`
3. Old ChromaDB entries for this `file_id` are deleted (using stored chunk UUIDs)
4. New chunks are enriched, embedded (Ollama), inserted into PostgreSQL and ChromaDB
5. `files` row updated: `version++`, `updated_by`, `updated_at`
6. Neo4j graph updated: old document node replaced with fresh entity extraction

---

## 12. AI-Transcribed Minutes of Meeting

**Endpoints:**
- `POST /api/mom/transcribe` — process audio file or raw text transcript into structured MoM
- `POST /api/mom/save` — persist to `minutes` table
- `GET /api/mom` — list saved MoMs (filtered by `accessible_to`)
- `POST /api/mom/{id}/export-to-hub` — push MoM as a document into the Knowledge Hub

### Input modes

The MoM feature supports two input paths:

**Audio recording (primary):**  
The user records meeting audio directly in the browser (via the Web Audio API) or uploads an audio file (`.mp3`, `.wav`, `.m4a`). The audio is sent to the backend where **OpenAI Whisper** (running locally via the `whisper` Python library) transcribes it to text. Whisper is run locally — no external API call is made. The `base` or `small` model variant is recommended for speed on CPU; `medium` for higher accuracy on GPU.

```python
import whisper
model = whisper.load_model("base")
result = model.transcribe("meeting_audio.mp3")
raw_transcript = result["text"]
```

**Raw text paste (secondary):**  
The user pastes a pre-existing transcript directly. Skips the Whisper step entirely.

### Transcription Flow

```
Input: audio file OR raw transcript text
    │
    ├── [Audio path]:
    │     Whisper (local) → raw_transcript text
    │
    ├── Qwen 3.5 9B call (MoM extraction prompt):
    │     Returns JSON:
    │     {
    │       "title": "...",
    │       "summary": "...",
    │       "attendees": ["name1", "name2"],
    │       "decisions": ["decision1"],
    │       "action_items": [{ "text": "...", "owner": "...", "due": "..." }]
    │     }
    │
    └── Return structured MoM to frontend for review
```

### Export to Hub

When the user exports to the Knowledge Hub:
1. MoM is serialised to formatted text
2. Passed through the full upload pipeline (chunk → enrich → embed → graph index)
3. Stored in `files` with the MoM's `accessible_to` scope
4. Action items from the MoM are written to `action_items` with `source_type: 'mom'`

---

## 13. Action Item Tracker

**Endpoints:**
- `GET /api/action-items` — list all (filtered by accessible_to)
- `POST /api/action-items` — create manually
- `PATCH /api/action-items/{id}` — update items array (complete, assign)
- `DELETE /api/action-items/{id}` — delete
- `POST /api/action-items/extract` — extract from a document (LLM call)

### Extraction Logic

```
Input: document text (truncated to 16,000 chars)
    │
    ├── Qwen 3.5 9B call with extraction prompt:
    │     Looks for: assigned tasks, action verbs, open items, pending approvals
    │     Returns JSON array: ["Review Q3 budget and share by Friday", ...]
    │
    └── Each string wrapped in { id: uuid, text, completed: False }
```

### Storage

Each record in `action_items` has:
- `file_id` / `source_id` — which document or MoM it came from
- `source_type` — `'file'` or `'mom'`
- `items` — JSONB array of `{ id, text, completed, assignees: [user_id] }`
- `accessible_to` — inherits from the source document

---

## 14. Intelligence Feed (Tech Sensing)

**Entry point:** `POST /api/feed/refresh`

This feature automatically fetches, filters, scores, and caches industry news per department.

### Source configuration (`config.json`)

Each source specifies:
```json
{
  "name": "TechCrunch AI",
  "url": "https://techcrunch.com/...",
  "rss": "https://techcrunch.com/.../feed/",
  "parts": ["Tech Management", "PRISM"]
}
```
### Pipeline per source

```
For each source filtered by requested part:
    │
    ├── [RSS source]:
    │     feedparser.parse(rss_url)
    │     if fails: raw HTTP fetch → sanitize XML → feedparser.parse(string)
    │     if fails: web search fallback
    │
    ├── Apply part-specific LLM filter:
    │     PMO: keep only AI-in-PM articles
    │     Tech Management: keep only technical/research articles
    │     PRISM: assign High/Medium/Low worklet relevance tag
    │
    └── Collect into grouped result object
```

### Filtering (LLM-based, Qwen 3.5 9B)

Each filter/scorer is a separate LLM call with a targeted system prompt:

- **PMO filter:** Keeps articles about AI applied to project management, agile, planning. Discards generic PM advice.
- **Tech Sensing filter:** Keeps technical content (new models, tools, research). Discards business/consumer news.
- **PRISM worklet tagger:** Assigns `High` / `Medium` / `Low` based on whether an article could inspire a 3-5 day hands-on engineering task.

All three have 3-attempt retry logic with exponential backoff. On persistent failure, articles are kept (fail-open policy).

### Live Search

`POST /api/feed/live-search` accepts a free-text query and performs a real-time search using the **DuckDuckGo Search API** (via the `duckduckgo-search` Python library — no API key required). Results are returned directly without going through the feed cache, surfacing articles beyond the curated RSS sources.

### Caching

Results are stored as a single JSON blob in `feed_cache` (one row, id='latest'). Subsequent `GET /api/feed?part=X` reads from cache. Cache is invalidated only when `POST /api/feed/refresh` is explicitly called.

---

## 15. AI Literacy Quizzes

**Endpoints:**
- `GET /api/quiz` — fetch quiz questions
- `POST /api/quiz/score` — submit score (upserts by user_id)
- `GET /api/quiz/leaderboard` — top scores across the org

### Score storage

```sql
quiz_scores (
  user_id TEXT PRIMARY KEY,   -- only one record per user
  user_name TEXT,
  quiz_id TEXT,
  score INTEGER,
  total INTEGER,
  attempted_at TIMESTAMPTZ
)
```

Retaking a quiz does an `INSERT ... ON CONFLICT DO UPDATE` — the new score replaces the old one. The leaderboard is ordered by `score DESC, attempted_at ASC`.

### Current state & roadmap

Quiz questions are currently **hardcoded** — a static set of AI fundamentals questions is served from a fixed list in the backend. The intended next step is to make quiz content **dynamic**: the Intelligence Feed pipeline surfaces trending AI topics and new model/technique releases each week, and the plan is to use this as an input to automatically generate fresh quiz questions aligned with what's currently relevant in the field. This closes the loop between "what the team is reading" and "what the team is being tested on."

---

## 16. Task Forces

Cross-departmental working groups with their own feed, action items, and member management.

**Key tables:** `task_forces`, `tf_updates`, `tf_action_items`

**Visibility rules:**
- Members see only task forces they belong to
- Part Heads see all task forces within their part
- MD sees all task forces

**Endpoints:**
- `GET /api/task-forces` — list (filtered by user role)
- `POST /api/task-forces` — create
- `PATCH /api/task-forces/{id}` — update name/status/members
- `POST /api/task-forces/{id}/updates` — post a status/milestone/decision update
- `POST /api/task-forces/{id}/action-items` — add an action item
- `PATCH /api/task-forces/{id}/action-items/{aid}` — mark done / update

---

## 17. Report Templates

Templates define the structure a generated report should follow. Template text is extracted and stored separately from the Knowledge Hub.

**Flow:**
1. Upload template → `POST /api/report-templates` → extract text → store in `report_templates`
2. Select template + source files → `POST /api/report-templates/{id}/generate-from-files`
3. The LLM receives: template structure + source document content + user instruction
4. Output conforms to the template format

---

## 18. RAG Evaluation

**Endpoints:**
- `POST /api/chat/evaluate` — evaluate a single Q&A pair
- `GET /api/chat/eval-summary` — get rolling averages

After a chatbot response, the frontend can optionally submit the query + answer for quality scoring. Three metrics are computed by a Qwen 3.5 9B judge:

| Metric | What it measures |
|---|---|
| `context_precision` | Were the retrieved chunks actually relevant to the query? |
| `faithfulness` | Is the answer supported by the context, or did the LLM hallucinate? |
| `response_relevance` | Does the answer actually address the question asked? |

Each metric is a float 0–1. Results are stored in `rag_evaluations`. The PostgreSQL function `update_rag_eval_summary` is called after each evaluation to maintain rolling averages in `rag_eval_summary` without rescanning the full table.

---

## 19. API Endpoint Reference

### Files / Knowledge Hub
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/files/upload` | Upload a document |
| `GET` | `/api/files` | List files (filtered by user's part) |
| `DELETE` | `/api/files/{id}` | Delete file + chunks + graph nodes |
| `POST` | `/api/files/{id}/lock` | Lock file for editing |
| `POST` | `/api/files/{id}/unlock` | Release lock |
| `POST` | `/api/files/{id}/replace` | Upload a new version |
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
| `DELETE` | `/api/report-templates/{id}` | Delete template |
| `POST` | `/api/report-templates/{id}/generate` | Generate from template + text |
| `POST` | `/api/report-templates/{id}/generate-from-files` | Generate from template + files |

### Refiner
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/refine` | Analyse document + return suggestions |
| `POST` | `/api/refine/{id}/save` | Save refined version + re-index |

### Feed
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/feed` | Get cached feed for a part |
| `POST` | `/api/feed/refresh` | Re-run pipeline for a part |
| `GET` | `/api/feed/sources` | List configured sources |
| `POST` | `/api/feed/sources` | Add/update a source |
| `POST` | `/api/feed/live-search` | On-demand DuckDuckGo web search |
| `GET` | `/api/feed/leaderboard` | Live open-source LLM rankings |

### MoM, Action Items, Task Forces
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/mom/transcribe` | Process transcript → structured MoM |
| `POST` | `/api/mom/save` | Save MoM |
| `GET` | `/api/mom` | List saved MoMs |
| `POST` | `/api/mom/{id}/export-to-hub` | Push MoM into Knowledge Hub |
| `GET` | `/api/action-items` | List action items |
| `POST` | `/api/action-items/extract` | Extract from document text |
| `PATCH` | `/api/action-items/{id}` | Update items |
| `GET` | `/api/task-forces` | List task forces |
| `POST` | `/api/task-forces` | Create task force |
| `PATCH` | `/api/task-forces/{id}` | Update task force |
| `POST` | `/api/task-forces/{id}/updates` | Post update |
| `POST` | `/api/task-forces/{id}/action-items` | Add action item |

### Chatroom
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/chatroom` | Fetch conversation messages |
| `POST` | `/api/chatroom` | Send message |
| `DELETE` | `/api/chatroom/{id}` | Delete message |
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

## 20. Alternative Cloud Stack

A parallel cloud-hosted implementation exists using managed services instead of local infrastructure. It uses the same business logic, API routes, and prompt designs — only the infrastructure layer differs.

| Component | Local stack (this document) | Cloud stack |
|---|---|---|
| Backend | FastAPI (Python) | Node.js (ESM) + Express |
| LLM | Qwen 3.5 9B (Q4_K_M) via Ollama | Gemini 2.5 Flash via Vertex AI |
| Embedding model | `qwen3-embedding:0.6b` via Ollama | `text-embedding-004` (768-dim) via Vertex AI |
| Vector store | ChromaDB (local persistent) | Supabase PostgreSQL + pgvector (HNSW) |
| Relational DB | PostgreSQL (psycopg2, direct) | Supabase (PostgreSQL + PostgREST JS client) |
| Graph DB | Neo4j (self-hosted) | Neo4j (AuraDB managed) |
| File storage | Local filesystem | Supabase Storage (S3-compatible) |
| Vector search | ChromaDB `.query()` + Python post-filter | `match_chunks` SQL RPC (pgvector `<=>` operator) |
| Chatroom vector search | ChromaDB `kernel_chatroom_chunks` | `match_chatroom_chunks` SQL RPC |
| Auth | Custom / none | Supabase service key (bypasses RLS) |

### Key structural differences

**pgvector vs ChromaDB:**  
In the cloud stack, the `chunks` table has a `vector(768)` embedding column and an HNSW index. Vector search is a single SQL call (`match_chunks` RPC) that filters by `accessible_to` and computes cosine similarity in one step. In the local stack, embeddings live in ChromaDB and text lives in PostgreSQL — a two-step lookup is needed (ChromaDB → get IDs → PostgreSQL → get text).

**No task_type distinction in Ollama embeddings:**  
The Vertex AI `text-embedding-004` model accepts a `task_type` parameter (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`) which adjusts the embedding for its intended use. Ollama embedding models do not support this — the same model and call signature is used for both document indexing and query embedding.

**Single-user LLM concurrency:**  
Ollama serves one request at a time. The cloud stack (Gemini via Vertex AI) handles concurrent requests natively. For the local stack to support multiple simultaneous users, replace Ollama with vLLM or SGLang which implement continuous batching for true concurrent serving.
