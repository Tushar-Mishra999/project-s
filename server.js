import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { supabase, ragReady } from './lib/clients.js';
import { generateChat, generateText } from './lib/llm.js';
import { runFeedPipeline } from './lib/feed.js';
import { extractText } from './lib/extract.js';
import { chunkDocument, addContextPrefix } from './lib/chunk.js';
import {
  enrichChunk,
  embedText,
  buildEmbeddingInput,
  rerankChunks,
} from './lib/rag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

const PORT = process.env.PORT || 3001;
if (!process.env.FIRECRAWL_API_KEY || !process.env.GEMINI_API_KEY) {
  console.error('Missing FIRECRAWL_API_KEY or GEMINI_API_KEY in .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'client', 'dist')));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// ---------- Tab 1: Tech Sensing Feed ----------
// Cache strategy: store the most recent run in Supabase (or memory fallback).
// GET  /api/feed         -> return cached payload (or null if never run)
// POST /api/feed/refresh -> run the pipeline, overwrite cache, return result
let memoryFeedCache = null;
let pipelineRunning = false;

async function readFeedCache() {
  if (supabase) {
    const { data, error } = await supabase
      .from('feed_cache')
      .select('data, generated_at')
      .eq('id', 'latest')
      .maybeSingle();
    if (error) {
      console.warn('feed_cache read error:', error.message);
      return memoryFeedCache;
    }
    return data ? { ...data.data, generatedAt: data.generated_at } : null;
  }
  return memoryFeedCache;
}

async function writeFeedCache(payload) {
  memoryFeedCache = payload;
  if (supabase) {
    const { error } = await supabase
      .from('feed_cache')
      .upsert({
        id: 'latest',
        data: payload,
        generated_at: payload.generatedAt,
        updated_at: new Date().toISOString(),
      });
    if (error) console.warn('feed_cache write error:', error.message);
  }
}

app.get('/api/feed', async (_req, res) => {
  const cached = await readFeedCache();
  res.json({ ...(cached || { sources: {}, count: 0, generatedAt: null }), pipelineRunning });
});

app.post('/api/feed/refresh', (_req, res) => {
  if (pipelineRunning) return res.status(202).json({ status: 'running' });
  pipelineRunning = true;
  const started = Date.now();
  console.log(`\n=== /api/feed/refresh at ${new Date().toISOString()} ===`);
  runFeedPipeline(config)
    .then(async ({ grouped, total, errors = [] }) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`Done in ${elapsed}s. ${total} items / ${Object.keys(grouped).length} sources. ${errors.length} errors.`);
      const payload = {
        generatedAt: new Date().toISOString(),
        count: total,
        sources: grouped,
        errors,
      };
      await writeFeedCache(payload);
    })
    .catch((err) => {
      console.error('feed pipeline error:', err);
    })
    .finally(() => {
      pipelineRunning = false;
    });
  res.status(202).json({ status: 'started' });
});

// ---------- Worklet generator ----------
const WORKLET_SYSTEM = `You are a research mentor designing hands-on student projects ("worklets") inspired by recent technology news.

Given a news item, propose ONE concrete 3-5 day worklet a 3rd/4th-year engineering student or fresher could complete. Return MARKDOWN with this exact structure:

**[Worklet title]**

*Why it matters:* one sentence linking the news to a learning opportunity.

**Goal:** one sentence describing the deliverable.

**Suggested approach:**
1. step one
2. step two
3. step three
4. step four (optional)

**Skills you'll practise:** 4-6 short tags, comma-separated.

**Stretch goal:** one optional extension.

Be specific and practical. Avoid filler. No introductions or meta-commentary — start directly with the bold title.`;

app.post('/api/worklet', async (req, res) => {
  const { title, summary, source, url } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const userMsg = [
      `Title: ${title}`,
      source ? `Source: ${source}` : null,
      summary ? `Summary: ${summary}` : null,
      url ? `URL: ${url}` : null,
    ].filter(Boolean).join('\n');
    const worklet = await generateText({
      model: config.models.scoring, // Flash is enough; cheap structured output
      system: WORKLET_SYSTEM,
      user: userMsg,
      maxTokens: 800,
    });
    res.json({ worklet });
  } catch (err) {
    console.error('[worklet] error:', err);
    res.status(500).json({ error: err.message || 'worklet generation failed' });
  }
});

// ---------- Shared: parts list ----------
app.get('/api/parts', (_req, res) => {
  res.json({ parts: config.parts || [] });
});

// ---------- Tab 2: list uploaded files ----------
app.get('/api/files', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const part = req.query.part;
  try {
    let q = supabase.from('files').select('*').order('uploaded_at', { ascending: false });
    if (part) q = q.contains('accessible_to', [part]);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ files: data });
  } catch (err) {
    console.error('list files error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Tab 2: Upload + ingest ----------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const uploadedBy = req.body.uploaded_by;
  let accessibleTo = req.body.accessible_to;
  if (typeof accessibleTo === 'string') {
    try { accessibleTo = JSON.parse(accessibleTo); } catch { accessibleTo = [accessibleTo]; }
  }
  if (!uploadedBy || !Array.isArray(accessibleTo) || accessibleTo.length === 0) {
    return res.status(400).json({ error: 'uploaded_by and accessible_to are required' });
  }

  const filename = req.file.originalname;
  const ext = extname(filename).slice(1).toLowerCase();
  const filetype = req.file.mimetype || ext;

  console.log(`\n[upload] ${filename} (${filetype}) by ${uploadedBy} -> ${accessibleTo.join(',')}`);

  try {
    // 1. Extract
    const extracted = await extractText(req.file.buffer, filetype);
    if (!extracted.text || extracted.text.trim().length < 30) {
      return res.status(422).json({ error: 'No extractable text found in file' });
    }

    // 2. Chunk
    const rawChunks = chunkDocument(extracted, config.rag);
    const chunks = addContextPrefix(rawChunks);
    console.log(`[upload] ${chunks.length} chunks`);

    // 3. Upload original to Supabase Storage
    const storagePath = `${randomUUID()}-${filename.replace(/[^\w.\-]+/g, '_')}`;
    const { error: storageErr } = await supabase
      .storage.from('documents')
      .upload(storagePath, req.file.buffer, {
        contentType: filetype,
        upsert: false,
      });
    if (storageErr) throw new Error('storage upload failed: ' + storageErr.message);
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(storagePath);
    const fileUrl = pub.publicUrl;

    // 4. Insert files row
    const { data: fileRow, error: fileErr } = await supabase
      .from('files')
      .insert({
        filename,
        filetype: ext || filetype,
        file_url: fileUrl,
        uploaded_by: uploadedBy,
        accessible_to: accessibleTo,
      })
      .select()
      .single();
    if (fileErr) throw new Error('files insert failed: ' + fileErr.message);

    // 5. Enrich + embed + insert per chunk
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      let enriched = { summary: '', keywords: [], hypothetical_questions: [] };
      try {
        enriched = await enrichChunk(c.text, config.models.enrichment);
      } catch (err) {
        console.warn(`[upload] enrichment failed for chunk ${i}: ${err.message}`);
      }

      const embeddingInput = buildEmbeddingInput(enriched) || c.text.slice(0, 2000);
      let embedding;
      try {
        embedding = await embedText(embeddingInput, config.embeddingModel, 'document');
      } catch (err) {
        console.warn(`[upload] embed failed for chunk ${i}: ${err.message}`);
        continue;
      }

      const { error: chunkErr } = await supabase.from('chunks').insert({
        file_id: fileRow.id,
        chunk_text: c.text,
        chunk_summary: enriched.summary,
        keywords: enriched.keywords,
        hypothetical_questions: enriched.hypothetical_questions,
        embedding,
        chunk_index: i,
      });
      if (chunkErr) {
        console.warn(`[upload] chunk insert failed (${i}): ${chunkErr.message}`);
      } else {
        inserted += 1;
      }
    }

    console.log(`[upload] done. file_id=${fileRow.id}, ${inserted}/${chunks.length} chunks stored`);
    res.json({ success: true, file_id: fileRow.id, chunk_count: inserted });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message || 'upload failed' });
  }
});

// ---------- Tab 2/3: Retrieve ----------
async function retrieve({ query, part }) {
  const ready = ragReady();
  if (!ready.ok) {
    const e = new Error(`RAG not configured: missing ${ready.missing.join(', ')}`);
    e.status = 503;
    throw e;
  }
  const queryEmbedding = await embedText(query, config.embeddingModel, 'query');

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    part_filter: part,
    match_count: config.rag.vector_search_top_k,
  });
  if (error) throw new Error('vector search failed: ' + error.message);
  if (!data || data.length === 0) return [];

  const reranked = await rerankChunks(query, data, config.models.reranker);
  return reranked.slice(0, config.rag.rerank_top_n);
}

app.post('/api/retrieve', async (req, res) => {
  const { query, part } = req.body || {};
  if (!query || !part) return res.status(400).json({ error: 'query and part are required' });
  try {
    const chunks = await retrieve({ query, part });
    res.json({ chunks });
  } catch (err) {
    console.error('[retrieve] error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------- Tab 3: Chat ----------
const CHAT_SYSTEM =
  "You are a knowledge assistant with access to internal documents. Answer the user's question using only the context provided below. If the answer is not present in the context, say 'I could not find this in the uploaded documents' — do not use general knowledge. Always cite the source filename at the end of your answer.";

app.post('/api/chat', async (req, res) => {
  const { query, part, conversation_history } = req.body || {};
  if (!query || !part) return res.status(400).json({ error: 'query and part are required' });
  try {
    const chunks = await retrieve({ query, part });

    const contextBlock = chunks.length
      ? chunks
          .map((c) => {
            const label =
              c.filetype && c.filetype.toLowerCase().includes('pptx')
                ? `Slide ${c.chunk_index + 1}`
                : `Chunk ${c.chunk_index}`;
            return `[Source: ${c.filename}, ${label}]\n${c.chunk_text}`;
          })
          .join('\n\n')
      : '(no matching context found)';

    const history = Array.isArray(conversation_history) ? conversation_history : [];
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: `--- Context ---\n${contextBlock}\n\n--- Question ---\n${query}`,
      },
    ];

    const answer = await generateChat({
      model: config.models.chat,
      system: CHAT_SYSTEM,
      messages,
      maxTokens: 1024,
    });

    const sources = chunks.map((c) => ({
      filename: c.filename,
      file_url: c.file_url,
      chunk_index: c.chunk_index,
      filetype: c.filetype,
    }));
    res.json({ answer, sources });
  } catch (err) {
    console.error('[chat] error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rag: ragReady() }));

if (process.env.NODE_ENV === 'production') {
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(join(__dirname, 'client', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
