# Build Prompt — Project S (Knowledge Management System)

You are building a full-stack Knowledge Management System (KMS) for an organisation. Follow every specification exactly. Build the complete project from scratch.

---

## 1. What You Are Building

A multi-tab web application for an organisation with internal parts (departments) and external teams. It provides:

- **Tech Sensing Feed** — curated AI news per department from RSS/web sources
- **Knowledge Library** — upload documents (PDF, DOCX, PPTX, XLSX), RAG-powered search and chatbot
- **Insights Chatbot** — RAG chatbot with Graph RAG, hybrid vector+graph search, eval metrics
- **Action Items** — AI-extracted action items from documents
- **Minutes of Meeting (MoM)** — record, transcribe, summarise, and email meeting minutes
- **Report Generator** — AI-generated reports from templates or uploaded files
- **Task Forces** — cross-team working groups with updates and action items
- **Executive Chatroom** — private channel for MD and Part Heads, RAG-searchable
- **AI Quizzes** — quiz on RAG concepts with a leaderboard
- **Home tab** — personalised dashboard

---

## 2. User Roles & Access

| Role | Scope | Description |
|---|---|---|
| `MD` | All | Managing Director — sees everything |
| `PartHead` | Their part | Head of a department |
| `Member` | Their part | Internal department member |
| `TeamHead` | Their team | Head of an external team |
| `Member` (team) | Their team | External team member |

**Parts (internal departments):** Tech Management, PRISM, PMO, Data Management, MD

**Teams (external):** Team 1, Team 2, Team 3

Documents and action items are tagged with `accessible_to` (array of part/team names). Users only see content accessible to their part or team. MD sees all.

---

## 3. Tech Stack

### Backend
```json
{
  "type": "module",
  "dependencies": {
    "@google/genai": "^0.7.0",
    "@sparticuz/chromium": "^148.0.0",
    "@supabase/supabase-js": "^2.45.4",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "googleapis": "^171.4.0",
    "google-auth-library": "^9.0.0",
    "html-to-docx": "^1.8.0",
    "jszip": "^3.10.1",
    "mammoth": "^1.8.0",
    "marked": "^14.1.3",
    "multer": "^1.4.5-lts.1",
    "neo4j-driver": "^5.27.0",
    "openai": "^6.36.0",
    "pdf-parse": "^1.1.1",
    "puppeteer-core": "^24.43.0",
    "rss-parser": "^3.13.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "concurrently": "^9.0.1"
  },
  "scripts": {
    "start": "concurrently -n server,client -c blue,green \"npm run server\" \"npm run client\"",
    "server": "node server.js",
    "client": "npm --prefix client run dev",
    "install:all": "npm install && npm --prefix client install",
    "build": "npm --prefix client install && npm --prefix client run build",
    "production": "NODE_ENV=production node server.js"
  }
}
```

### Frontend (inside `client/` folder)
- React 18 + Vite
- `react-markdown` for rendering markdown
- No UI component library — custom CSS only
- Dark theme, monospace font

### External Services
- **Supabase** — PostgreSQL (pgvector), Storage (file uploads), Auth not used
- **Google Vertex AI** — Gemini 2.5 Flash (LLM), text-embedding-004 (embeddings)
- **Neo4j Aura** — Knowledge graph for Graph RAG (optional, gracefully disabled if not configured)
- **Gmail API** — Email delivery for MoM (optional)

---

## 4. Environment Variables

Copy `.env.example` to `.env` and fill in values. Required:

```
GOOGLE_APPLICATION_CREDENTIALS_JSON=<full GCP service account JSON as single line>
GOOGLE_CLOUD_PROJECT=<your GCP project ID>
GOOGLE_CLOUD_LOCATION=us-central1
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=<supabase service role key>
```

Optional (features degrade gracefully without these):
```
NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=<password>
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=
GMAIL_REFRESH_TOKEN=
APP_URL=https://your-app.com
PORT=3001
```

---

## 5. Project File Structure

```
project-s/
├── server.js               # Express server, all API routes
├── config.json             # Sources, models, RAG config
├── supabase-setup.sql      # Full DB schema — run once in Supabase
├── .env                    # Environment variables (not committed)
├── .env.example            # Template for env vars
├── package.json
├── lib/
│   ├── clients.js          # Supabase client, ragReady()
│   ├── llm.js              # Vertex AI Gemini wrapper (generateText, generateChat)
│   ├── rag.js              # embedText, enrichChunk, rerankChunks, retrieve
│   ├── chunk.js            # Document chunking (word-count based)
│   ├── extract.js          # Text extraction from PDF/DOCX/PPTX/XLSX
│   ├── feed.js             # RSS feed pipeline
│   ├── actionItems.js      # AI action item extraction
│   ├── graphExtract.js     # Entity extraction, Neo4j graph write/search, query router
│   ├── neo4j.js            # Neo4j driver, runQuery, initConstraints
│   ├── htmlToDocx.js       # HTML → DOCX conversion
│   └── htmlToPdf.js        # HTML → PDF via Puppeteer
└── client/
    ├── package.json        # React + Vite + react-markdown
    ├── vite.config.js      # Proxy /api → localhost:3001
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx          # Tab router, user selector
        ├── styles.css       # All styles — dark theme
        ├── tabs/
        │   ├── HomeTab.jsx
        │   ├── FeedTab.jsx
        │   ├── LibraryTab.jsx
        │   ├── ChatTab.jsx
        │   ├── ActionItemsTab.jsx
        │   ├── MinutesTab.jsx
        │   ├── ReportGeneratorTab.jsx
        │   ├── TaskForceTab.jsx
        │   ├── ChatroomTab.jsx
        │   ├── RetrievalTab.jsx
        │   └── AIQuizzesTab.jsx
        └── components/
            ├── ChatFAB.jsx         # Floating chatbot button
            └── QuickLinksFAB.jsx   # Quick navigation FAB
```

---

## 6. config.json (exact content)

```json
{
  "sources": [
    { "name": "Hugging Face Blog", "url": "https://huggingface.co/blog", "rss": "https://huggingface.co/blog/feed.xml", "parts": ["Tech Management","PRISM"] },
    { "name": "MarkTechPost", "url": "https://www.marktechpost.com/", "rss": "https://www.marktechpost.com/feed/", "parts": ["Tech Management","PRISM"] },
    { "name": "TechCrunch AI", "url": "https://techcrunch.com/category/artificial-intelligence/", "rss": "https://techcrunch.com/category/artificial-intelligence/feed/", "parts": ["Tech Management","PRISM"] },
    { "name": "Times of India Tech", "url": "https://timesofindia.indiatimes.com/technology", "rss": "https://timesofindia.indiatimes.com/rssfeeds/66949542.cms", "parts": ["Tech Management","PRISM"] },
    { "name": "Engadget", "url": "https://www.engadget.com", "rss": "https://www.engadget.com/rss.xml", "parts": ["Tech Management","PRISM"] },
    { "name": "Rebel's Guide to Project Management", "url": "https://rebelsguidetopm.com", "rss": "https://rebelsguidetopm.com/feed/", "parts": ["PMO"] },
    { "name": "ProjectManager Blog", "url": "https://www.projectmanager.com/blog", "rss": "https://www.projectmanager.com/blog/feed", "parts": ["PMO"] },
    { "name": "Project Times", "url": "https://www.projecttimes.com", "rss": "https://www.projecttimes.com/feed/", "parts": ["PMO"] },
    { "name": "PM Today", "url": "https://www.pmtoday.co.uk", "rss": "https://www.pmtoday.co.uk/feed", "parts": ["PMO"] },
    { "name": "Scrum Expert", "url": "https://www.scrumexpert.com", "rss": "https://www.scrumexpert.com/feed", "parts": ["PMO"] },
    { "name": "mostly.ai Blog", "url": "https://mostly.ai/blog", "geminiSearch": true, "parts": ["Data Management"] },
    { "name": "LabelYourData Blog", "url": "https://labelyourdata.com/articles", "geminiSearch": true, "parts": ["Data Management"] },
    { "name": "Microsoft News", "url": "https://news.microsoft.com", "rss": "https://news.microsoft.com/feed/", "parts": ["MD"] },
    { "name": "NVIDIA AI News", "url": "https://nvidianews.nvidia.com", "rss": "https://nvidianews.nvidia.com/cats/ai_platforms_deployment.xml", "parts": ["MD"] },
    { "name": "Intel Newsroom", "url": "https://newsroom.intel.com", "rss": "https://newsroom.intel.com/feed", "parts": ["MD"] }
  ],
  "maxItemsPerSource": 5,
  "maxItemsPerSourceByPart": { "MD": 3, "PMO": 10 },
  "parts": ["Tech Management", "PRISM", "PMO", "Data Management", "MD"],
  "models": {
    "scoring": "gemini-2.5-flash",
    "summarisation": "gemini-2.5-flash",
    "enrichment": "gemini-2.5-flash",
    "reranker": "gemini-2.5-flash",
    "chat": "gemini-2.5-flash"
  },
  "embeddingModel": "text-embedding-004",
  "embeddingDimensions": 768,
  "rag": {
    "vector_search_top_k": 20,
    "rerank_top_n": 5,
    "chunk_min_words": 300,
    "chunk_max_words": 600
  }
}
```

---

## 7. Database Schema (run in Supabase SQL Editor)

```sql
create extension if not exists vector;

-- files
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  filename text not null, filetype text not null, file_url text,
  uploaded_by text not null, accessible_to text[] not null default '{}',
  uploaded_at timestamptz default now(),
  locked_by_id text, locked_by_name text, locked_at timestamptz,
  version integer not null default 1, updated_by text, updated_at timestamptz
);

-- chunks (document fragments with embeddings)
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references files(id) on delete cascade,
  chunk_text text not null, chunk_summary text,
  keywords text[] default '{}', hypothetical_questions text[] default '{}',
  embedding vector(768), chunk_index integer, created_at timestamptz default now()
);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

-- vector search RPC
create or replace function match_chunks(
  query_embedding vector(768), part_filter text default null, match_count int default 20
) returns table (
  id uuid, file_id uuid, chunk_text text, chunk_summary text,
  keywords text[], hypothetical_questions text[], chunk_index integer,
  similarity float, filename text, filetype text, file_url text, uploaded_by text
) language sql stable as $$
  select c.id, c.file_id, c.chunk_text, c.chunk_summary, c.keywords,
    c.hypothetical_questions, c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity,
    f.filename, f.filetype, f.file_url, f.uploaded_by
  from chunks c join files f on f.id = c.file_id
  where part_filter is null or f.accessible_to @> array[part_filter]
  order by c.embedding <=> query_embedding limit match_count;
$$;

-- feed_cache
create table if not exists feed_cache (
  id text primary key default 'latest', data jsonb not null,
  generated_at timestamptz default now(), updated_at timestamptz default now()
);

-- action_items
create table if not exists action_items (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references files(id) on delete cascade,
  filename text not null, accessible_to text[] not null default '{}',
  assigned_by text, source_type text default 'file', source_id uuid,
  items jsonb not null default '[]',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- minutes of meeting
create table if not exists minutes (
  id uuid primary key default gen_random_uuid(),
  title text not null, summary text default '', attendees jsonb default '[]',
  decisions jsonb default '[]', action_items jsonb default '[]',
  transcript text default '', created_by text,
  accessible_to text[] not null default '{}', created_at timestamptz default now()
);

-- report_templates
create table if not exists report_templates (
  id uuid primary key default gen_random_uuid(),
  filename text not null, filetype text not null, file_url text,
  template_text text not null, uploaded_by text not null,
  uploaded_at timestamptz default now()
);

-- users
create table if not exists users (
  id text primary key, name text not null, role text not null,
  part text, team text, created_at timestamptz default now()
);

-- task_forces
create table if not exists task_forces (
  id uuid primary key default gen_random_uuid(),
  name text not null, status text not null default 'Active',
  parts text[] not null default '{}', teams text[] not null default '{}',
  owners text[] not null default '{}', members text[] not null default '{}',
  created_by text, created_at timestamptz default now(), updated_at timestamptz default now()
);

-- tf_updates
create table if not exists tf_updates (
  id uuid primary key default gen_random_uuid(),
  tf_id uuid references task_forces(id) on delete cascade,
  type text not null, author text not null, content text not null,
  created_at timestamptz default now()
);

-- tf_action_items
create table if not exists tf_action_items (
  id uuid primary key default gen_random_uuid(),
  tf_id uuid references task_forces(id) on delete cascade,
  text text not null, assignee text, due date, done boolean not null default false,
  created_at timestamptz default now()
);

-- email_tokens
create table if not exists email_tokens (
  key text primary key, tokens jsonb not null, updated_at timestamptz default now()
);

-- chatroom_messages
create table if not exists chatroom_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null default '',
  sender_id text not null, sender_name text not null,
  content text not null, created_at timestamptz default now()
);
create index if not exists chatroom_messages_conv_idx on chatroom_messages(conversation_id, created_at);

-- chatroom_chunks (for RAG over chatroom history)
create table if not exists chatroom_chunks (
  id uuid primary key default gen_random_uuid(),
  chunk_text text not null, topic_summary text,
  embedding vector(768), processed_date date not null,
  created_at timestamptz default now()
);
create index if not exists chatroom_chunks_embedding_idx on chatroom_chunks using hnsw (embedding vector_cosine_ops);

create or replace function match_chatroom_chunks(
  query_embedding vector(768), match_count int default 5
) returns table (id uuid, chunk_text text, topic_summary text, processed_date date, similarity float)
language sql stable as $$
  select id, chunk_text, topic_summary, processed_date,
    1 - (embedding <=> query_embedding) as similarity
  from chatroom_chunks order by embedding <=> query_embedding limit match_count;
$$;

-- quiz scores
create table if not exists quiz_scores (
  user_id text primary key, user_name text not null,
  quiz_id text not null default 'rag-basics',
  score integer not null, total integer not null default 5,
  attempted_at timestamptz default now()
);

-- rag evaluations
create table if not exists rag_evaluations (
  id uuid primary key default gen_random_uuid(),
  query text not null, answer text,
  context_precision float, faithfulness float, response_relevance float,
  created_at timestamptz default now()
);

create table if not exists rag_eval_summary (
  id integer primary key default 1,
  avg_context_precision float not null default 0,
  avg_faithfulness float not null default 0,
  avg_response_relevance float not null default 0,
  total_count integer not null default 0,
  updated_at timestamptz default now()
);
insert into rag_eval_summary (id) values (1) on conflict do nothing;

-- seed users
insert into users (id, name, role, part, team) values
  ('u_md','Aryan Sharma','MD',null,null),
  ('u_ph_tm','Arjun Mehta','PartHead','Tech Management',null),
  ('u_ph_prism','John Iyer','PartHead','PRISM',null),
  ('u_ph_dm','Karan Shah','PartHead','Data Management',null),
  ('u_ph_pmo','Ranjit Bose','PartHead','PMO',null),
  ('u_mem_tm','Sam Patel','Member','Tech Management',null),
  ('u_mem_prism','Nadia Verma','Member','PRISM',null),
  ('u_mem_dm','Diego Alvarez','Member','Data Management',null),
  ('u_mem_pmo','Lina Joshi','Member','PMO',null),
  ('u_th_t1','Asha Rao','TeamHead',null,'Team 1'),
  ('u_mem_t1','Vikram Singh','Member',null,'Team 1'),
  ('u_th_t2','Marco Bianchi','TeamHead',null,'Team 2'),
  ('u_mem_t2','Lea Fischer','Member',null,'Team 2'),
  ('u_th_t3','Hiro Tanaka','TeamHead',null,'Team 3')
on conflict do nothing;
```

Also create a **public Storage bucket named `documents`** in Supabase Storage UI.

---

## 8. Backend Architecture

### lib/clients.js
Exports:
- `supabase` — Supabase JS client (service role key, no session persistence)
- `ragReady()` — returns `{ ok: boolean, missing: string[] }` checking GOOGLE_APPLICATION_CREDENTIALS_JSON, GOOGLE_CLOUD_PROJECT, SUPABASE_URL, SUPABASE_SERVICE_KEY

### lib/llm.js
Uses `@google/genai` with `vertexai: true`. Lazy singleton `GoogleGenAI` client.

Exports:
- `generateText({ model, system, user, jsonMode, maxTokens, thinking })` — single-turn, thinking disabled by default (thinkingBudget: 0)
- `generateChat({ model, system, messages, maxTokens })` — multi-turn
- `generateChatGemma({ system, messages, maxTokens })` — via Vertex AI OpenAI-compat endpoint (model: `google/gemma-3-27b-it`)
- `generateChatGLM({ system, messages, maxTokens })` — via Vertex AI (GLM model)
- `generateChatKimi({ system, messages, maxTokens })` — via Vertex AI (Kimi K2)
- `generateWithParts({ model, system, parts, maxTokens })` — multimodal (images)
- `generateTextWithSearch({ model, system, user, maxTokens })` — Gemini with grounding

### lib/rag.js
Exports:
- `embedText(text, model, inputType)` — calls Vertex AI text-embedding-004 REST API directly:
  - Endpoint: `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict`
  - Body: `{ instances: [{ content: text, task_type: 'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY' }], parameters: { outputDimensionality: 768 } }`
  - Returns `json.predictions[0].embeddings.values`
- `enrichChunk(chunkText, model)` — LLM generates `{ summary, keywords[], hypothetical_questions[] }`
- `buildEmbeddingInput(enriched)` — joins summary + keywords + hypothetical_questions as embedding input
- `rerankChunks(query, chunks, model)` — LLM returns top-5 chunk indices, reorders array
- `stripJsonFences(text)` — removes ```json fences from LLM output

### lib/chunk.js
- `chunkDocument(extracted, ragConfig)` — splits text into chunks of 300–600 words, respects paragraph boundaries
- `addContextPrefix(chunks)` — adds document-level context to each chunk for HyDE

### lib/extract.js
- `extractText(buffer, filetype)` — extracts plain text from PDF (pdf-parse), DOCX (mammoth), PPTX (jszip+xml), XLSX (xlsx), TXT

### lib/neo4j.js
- Lazy Neo4j driver singleton using `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
- `neo4jReady()` — returns true if all 3 env vars set
- `runQuery(cypher, params)` — runs Cypher, returns records
- `initConstraints()` — creates uniqueness constraints for Document, Topic, Technology, Person, Project nodes

### lib/graphExtract.js
- `extractEntities(text, model)` — LLM extracts `{ topics[], technologies[], people[], projects[], decisions[] }` from document text (maxTokens: 2048)
- `writeDocumentToGraph({ fileId, filename, filetype, fileUrl, uploadedBy, part, entities })` — MERGEs Document node, creates Topic/Technology/Person/Project/Decision nodes with relationships (COVERS, MENTIONS_TECH, MENTIONS_PERSON, PART_OF, RECORDS). Creates RELATED_TO edges between co-occurring topics.
- `deleteDocumentFromGraph(fileId)` — DETACH DELETEs document and its Decision nodes
- `routeQuery(query, model)` — LLM decides `"vector"` or `"graph"` search type, extracts named entities (maxTokens: 512)
- `graphSearch({ entities, partFilter })` — finds document IDs in Neo4j matching topics (+ 1-hop RELATED_TO), technologies, people, projects; fetches chunks from Supabase; applies partFilter

---

## 9. RAG Pipeline (upload flow)

When a document is uploaded (`POST /api/upload`):
1. Extract text from buffer using `extractText()`
2. Chunk into 300–600 word segments using `chunkDocument()`
3. Upload original file to Supabase Storage bucket `documents`
4. Insert row into `files` table
5. For each chunk: `enrichChunk()` → `buildEmbeddingInput()` → `embedText()` → insert into `chunks`
6. **Graph indexing (non-blocking):** if Neo4j configured → `extractEntities()` → `writeDocumentToGraph()`

### Chat RAG pipeline (`POST /api/chat`)
1. `routeQuery(query)` fired in parallel with route request to `/api/chat/route`
2. If route = `"graph"` and Neo4j ready → `graphSearch()` → if empty fallback to vector
3. If route = `"vector"` → `embedText(query, model, 'query')` → `match_chunks()` RPC → `rerankChunks()`
4. Build context block from top chunks
5. `generateChat()` with system prompt + context + conversation history

---

## 10. RAG Evaluation Metrics

Three metrics computed on demand (user clicks "Evaluate Response" button):

### Context Precision@K
For each chunk at rank k: LLM judges if chunk is relevant to query (yes/no).
`CP = Σ(k=1..K) [precision@k × relevance_k] / total_relevant`
where precision@k = (relevant chunks up to k) / k

### Faithfulness
1. LLM decomposes answer into atomic claims
2. For each claim: LLM judges if it's supported by the retrieved context
3. `faithfulness = supported_claims / total_claims`

### Response Relevance
1. LLM generates 3 artificial questions from the answer
2. Embed query + all 3 artificial questions using `embedText()`
3. `response_relevance = mean(cosine_similarity(query_embedding, question_i_embedding))`

All three scores stored in `rag_evaluations`. Running averages maintained in `rag_eval_summary` (single row, upserted after each eval).

---

## 11. API Endpoints

### Auth & Users
- `GET /api/users` — list all users
- `GET /api/parts` — list all parts from config

### Feed
- `GET /api/feed?part=X` — get cached feed for part
- `POST /api/feed/refresh` — trigger pipeline for caller's part
- `GET /api/feed/sources` — list configured sources
- `POST /api/feed/sources` — add new source
- `GET /api/feed/live-search?query=X` — Gemini grounded search

### Library / Files
- `GET /api/files?user_id=X` — list files accessible to user
- `POST /api/upload` (multipart) — upload + chunk + embed document
- `DELETE /api/files/:id` — delete file, chunks, graph nodes
- `POST /api/files/:id/lock` — lock file for editing
- `POST /api/files/:id/unlock` — release lock
- `POST /api/files/:id/replace` (multipart) — replace file in place (new version)
- `POST /api/retrieve` — vector search over chunks

### Chat
- `POST /api/chat` — RAG chat (returns answer, sources, eval_chunks, search_type)
- `POST /api/chat/route` — routing-only call (returns search_type, reason)
- `POST /api/chat/evaluate` — compute RAG eval metrics, store in DB
- `GET /api/chat/eval-summary` — get running average scores

### Action Items
- `GET /api/action-items?user_id=X` — list all action item cards for user
- `POST /api/action-items/extract/:file_id` — AI-extract action items from file
- `POST /api/action-items` — save action items card
- `PUT /api/action-items/:id` — update card (toggle complete, reassign)
- `DELETE /api/action-items/:id` — delete card

### Minutes of Meeting
- `POST /api/minutes/transcribe` — transcribe audio/video via Gemini
- `POST /api/minutes/parse` — parse text transcript into structured MoM
- `GET /api/minutes` — list minutes accessible to user
- `POST /api/minutes` — save minutes
- `GET /api/minutes/:id` — get single minutes record
- `PUT /api/minutes/:id` — update minutes
- `DELETE /api/minutes/:id` — delete minutes
- `POST /api/minutes/:id/extract-action-items` — extract action items from minutes
- `POST /api/minutes/:id/save-to-hub` — chunk + embed minutes as a document in Library

### Report Generator
- `GET /api/report-templates` — list templates
- `POST /api/report-templates` — upload template
- `DELETE /api/report-templates/:id` — delete template
- `POST /api/report-templates/:id/generate` — generate filled report (HTML)
- `POST /api/report-templates/:id/generate-from-files` — generate from selected library files
- `POST /api/report/generate` — free-form report (no template)
- `POST /api/report/generate-from-files` — free-form from files
- `GET /api/render-pdf?url=X` — render HTML to PDF via Puppeteer
- `POST /api/render-docx` — convert HTML to DOCX
- `POST /api/render-xlsx` — generate XLSX from structured data
- `POST /api/xlsx/compile` — compile multiple XLSX files into one

### Task Forces
- `GET /api/task-forces` — list task forces visible to user
- `POST /api/task-forces` — create task force
- `GET /api/task-forces/:id` — get task force detail
- `PUT /api/task-forces/:id` — update task force
- `DELETE /api/task-forces/:id` — delete task force
- `GET /api/task-forces/:id/updates` — list updates
- `POST /api/task-forces/:id/updates` — post update
- `GET /api/task-forces/:id/action-items` — list action items
- `POST /api/task-forces/:id/action-items` — add action item
- `PUT /api/task-forces/:id/action-items/:aid` — toggle done
- `DELETE /api/task-forces/:id/action-items/:aid` — delete

### Executive Chatroom
- `GET /api/chatroom?user_id=X&with=Y` — fetch 1:1 conversation
- `POST /api/chatroom` — send message
- `DELETE /api/chatroom/:id` — delete message
- `POST /api/admin/chatroom/process-chunks` — partition messages into RAG-searchable chunks

### Email (Gmail)
- `GET /api/email/status` — check if Gmail connected
- `GET /api/email/auth` — start OAuth flow
- `GET /api/email/callback` — OAuth callback
- `GET /api/email/messages` — list emails
- `POST /api/email/summarize` — summarise email thread
- `POST /api/email/extract-actions` — extract action items from email
- `POST /api/email/upload-attachment` — upload email attachment to Library

### AI Quiz
- `GET /api/quiz/leaderboard` — get all scores
- `POST /api/quiz/score` — submit score
- `GET /api/leaderboard` — alias

### Misc
- `GET /api/health` — `{ ok: true, rag: boolean }`
- `POST /api/worklet` — run a one-off AI worklet (free-form LLM call)
- `POST /api/tech-sensing/report` — generate tech sensing report from feed data
- `POST /api/refine` — AI-refine a document chunk
- `PUT /api/refine/:id/save` — save refined chunk back to DB
- `POST /api/files/match` — match files by name/content

---

## 12. Frontend Architecture

### App.jsx
- Renders tab navigation (sidebar or top bar)
- Stores active user (selected from dropdown of all users)
- Passes `activePart`, `activeUserId`, `activeUser` to all tab components
- Renders `ChatFAB` and `QuickLinksFAB` overlays on all tabs

### Tab list and visibility
| Tab | Visible to |
|---|---|
| Home | All |
| Tech Sensing Feed | All (filtered by part) |
| Knowledge Library | All |
| Insights Chatbot | All |
| Action Items | All |
| Minutes of Meeting | Internal only |
| Report Generator | Internal only |
| Task Forces | All |
| Executive Chatroom | MD + PartHead only |
| AI Quizzes | All |
| Retrieval Debug | All (dev tool) |

### ChatFAB (floating chatbot)
- Floating action button in bottom-right corner
- Opens a 700px wide, 84vh tall chat panel
- Shows average RAG eval scores at top when there's at least 1 evaluation
- Chatbot with model selector (Gemini 2.5 Flash, Gemma, GLM, Kimi)
- Shows "Agent thinking…" bubble while waiting; transitions to "Graph Search" or "Vector Search" badge when routing resolves
- Each assistant message shows search type badge + Sources list + "Evaluate Response" button
- Toggle for "Include Exec Chatroom as source" (MD/PartHead only)

### Theme
- Dark background (`#0f0f0f` / `#1a1a1a`)
- Accent: indigo (`#6366f1`) / blue (`#3b82f6`)
- Text: `#e5e5e5` primary, `#a3a3a3` muted
- Border: `rgba(255,255,255,0.08)`
- Font: system monospace stack

---

## 13. Key Behaviours

### Access control
- Every API route that returns data filters by `user_id` → resolve user → check part/team → apply to Supabase queries
- MD sees all parts; PartHead/Member see only their part; TeamHead/Member see only their team
- `accessible_to` is a text[] column; filter uses `@> array[part_filter]`

### File locking
- Before editing a file, user locks it (`POST /api/files/:id/lock`)
- Lock stores `locked_by_id`, `locked_by_name`, `locked_at`
- Auto-released when user uploads a new version
- Other users see file as locked in Library UI

### Graph RAG
- On upload: entity extraction → write to Neo4j (non-blocking, fire-and-forget)
- On chat: LLM router decides vector vs graph → graph search finds doc IDs in Neo4j → fetch chunks from Supabase
- If Neo4j env vars missing: gracefully falls back to vector-only, no errors

### Chunking strategy
- Word-count based: 300–600 words per chunk
- Paragraph-aware: won't split mid-paragraph
- HyDE enrichment: each chunk gets LLM-generated summary, keywords, hypothetical questions
- Embedding input = summary + keywords + hypothetical_questions concatenated

---

## 14. Build Order for Cline

Build in this sequence to avoid dependency issues:

1. `supabase-setup.sql` — run in Supabase first
2. `package.json` + `npm install`
3. `config.json`
4. `.env` (from `.env.example`)
5. `lib/clients.js`
6. `lib/llm.js`
7. `lib/rag.js`
8. `lib/chunk.js`
9. `lib/extract.js`
10. `lib/neo4j.js`
11. `lib/graphExtract.js`
12. `lib/feed.js`
13. `lib/actionItems.js`
14. `lib/htmlToDocx.js` + `lib/htmlToPdf.js`
15. `server.js` — all routes
16. `client/` — Vite + React scaffold
17. `client/src/styles.css`
18. `client/src/App.jsx`
19. Each tab component
20. `ChatFAB.jsx` + `QuickLinksFAB.jsx`

---

## 15. Deployment (Render)

- **Build command:** `npm run build` (installs both server + client deps, builds React)
- **Start command:** `npm run production` (`NODE_ENV=production node server.js`)
- In production, Express serves the built React app from `client/dist/`
- All env vars set in Render dashboard
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` — paste the entire service account JSON as a single line
