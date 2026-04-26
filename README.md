# Knowledge Hub — Tech Sensing Feed + RAG

Three-tab full-stack app:

- **Tab 1 — Tech Sensing Feed**: Firecrawl scrapes 13 sources, Gemini Flash scores + summarises.
- **Tab 2 — Smart File Retrieval**: Upload PDF/DOCX/PPTX/TXT, chunked + enriched + embedded into Supabase pgvector. Plain-English search with reranking. PDF thumbnail preview, downloads.
- **Tab 3 — Insights Chatbot**: Conversational Q&A grounded only in retrieved chunks, with source citations.

## Setup

```bash
npm run install:all
```

Fill in `.env`:

```
FIRECRAWL_API_KEY=fc-...
GEMINI_API_KEY=AIza...          # used for all LLM calls (free tier)
VOYAGE_API_KEY=pa-...           # used for voyage-3 embeddings (free tier)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...     # service_role key (server-only — never ship to client)
PORT=3001
```

### One-time Supabase setup

1. Create a Supabase project (free tier is fine).
2. In the **SQL Editor**, paste and run `supabase-setup.sql`. This enables pgvector, creates the `files` + `chunks` tables, the HNSW index, and the `match_chunks` RPC.
3. In **Storage**, create a **public** bucket named `documents`.
4. From **Settings → API**, copy the project URL (→ `SUPABASE_URL`) and the **service_role** key (→ `SUPABASE_SERVICE_KEY`). Keep the service key on the server only.

Tab 1 works without Supabase/Voyage. Tabs 2 & 3 require all five keys.

## Run

```bash
npm start
```

- API on http://localhost:3001
- React on http://localhost:5173 (proxies `/api` to the API)

## Deploy on Render

Build command: `npm install && npm run build`
Start command: `npm run production`
Add all `.env` keys as Environment Variables in the Render dashboard, plus `NODE_ENV=production`.

## Project layout

```
.
├── server.js                 Express app + routes
├── lib/
│   ├── clients.js            Anthropic / OpenAI / Supabase clients
│   ├── feed.js               Tab 1 pipeline
│   ├── extract.js            PDF / DOCX / PPTX / TXT text extraction
│   ├── chunk.js              Heading- and paragraph-aware chunker
│   └── rag.js                Enrich, embed, rerank
├── config.json               Sources, parts, models, RAG params
├── supabase-setup.sql        Schema + RPC for Supabase
├── .env                      API keys (gitignored)
└── client/
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx           Tab shell
        ├── styles.css
        ├── lib/pdfPreview.js Lazy pdfjs-dist thumbnail rendering
        └── tabs/
            ├── FeedTab.jsx
            ├── RetrievalTab.jsx
            └── ChatTab.jsx
```
