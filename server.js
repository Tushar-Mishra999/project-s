import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

// Write Vertex AI service account JSON to a temp file so ADC picks it up.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credPath = join(tmpdir(), 'gcp-sa-key.json');
  writeFileSync(credPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
}

import { supabase, ragReady } from './lib/clients.js';
import { generateChat, generateText, generateWithParts } from './lib/llm.js';
import { runFeedPipeline } from './lib/feed.js';
import { extractActionItems } from './lib/actionItems.js';
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
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON in .env');
  process.exit(1);
}
if (!process.env.FIRECRAWL_API_KEY) {
  console.warn('FIRECRAWL_API_KEY not set — feed pipeline uses Gemini url_context instead of Firecrawl.');
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
    const fromDB = data ? { ...data.data, generatedAt: data.generated_at } : null;
    // Prefer the most recent data — memory may be newer if a Supabase write failed.
    if (memoryFeedCache && (!fromDB || memoryFeedCache.generatedAt > fromDB.generatedAt)) {
      return memoryFeedCache;
    }
    return fromDB;
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

app.get('/api/feed/sources', (_req, res) => {
  const cfg = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
  res.json({ sources: cfg.sources });
});

app.post('/api/feed/sources', (req, res) => {
  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  const cfgPath = join(__dirname, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  if (cfg.sources.some(s => s.name === name)) {
    return res.status(409).json({ error: 'A source with that name already exists' });
  }
  cfg.sources.push({ name, url });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.sources = cfg.sources;
  res.json({ sources: cfg.sources });
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
function stripHtmlTags(s) {
  return (s || '')
    // Remove non-content structural blocks before generic tag stripping
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchArticleText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return stripHtmlTags(html).slice(0, 12000);
  } catch {
    return null;
  }
}

const WORKLET_SYSTEM = `You are a senior research engineer drafting technically dense, descriptive worklet ideas inspired by recent technology news.

You will be given a news article — either the full article content or a short summary. Base the worklet on specific details, methods, results, or claims found in the article — not just the headline.

Propose ONE concrete worklet (~3-5 days of effort) a strong engineering student or junior engineer could execute. Return MARKDOWN as a SINGLE paragraph of MINIMUM 100 words, targeting 130-160 words (no bullets, no headings, no line breaks within the paragraph). Always finish the paragraph — never stop mid-sentence. If you find yourself under 100 words, expand with more implementation detail before stopping.

The paragraph MUST:
- Open with the worklet title in bold (e.g. **Quantising a 7B MoE router for edge inference**).
- Name specific architectures, algorithms, datasets, libraries, or APIs drawn from the article (e.g. INT8 quantisation, FlashAttention-2, ONNX Runtime, PyTorch FSDP, FAISS HNSW, LoRA, Triton kernels, vLLM, RAGAS) — at least 4-5 concrete technical terms.
- Describe the implementation approach in enough detail that an engineer can begin immediately — mention the key steps, tools, and data pipeline.
- State a measurable success criterion with a number (e.g. "≥30% latency reduction at <2% accuracy drop", "recall@10 above 0.85", "throughput >500 tok/s on a single A10G").
- Mention the dataset or benchmark used to measure it (e.g. MMLU, BEIR, ImageNet, MS MARCO, GSM8K, custom held-out split).
- Explain WHY this worklet matters — connect it to a real engineering problem or capability gap revealed by the article content.
- Be engineering-flavoured — no fluff, no career talk, no introductions.

Start the response directly with the bold title; do not preface with anything.`;

app.post('/api/worklet', async (req, res) => {
  const { title, summary, source, url } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const articleText = url ? await fetchArticleText(url) : null;
    const userMsg = [
      `Title: ${title}`,
      source ? `Source: ${source}` : null,
      url ? `URL: ${url}` : null,
      articleText
        ? `Full article content:\n${articleText}`
        : (summary ? `Summary: ${summary}` : null),
    ].filter(Boolean).join('\n\n');
    const worklet = await generateText({
      model: config.models.scoring,
      system: WORKLET_SYSTEM,
      user: userMsg,
      maxTokens: 1500,
      thinking: true,
    });
    res.json({ worklet });
  } catch (err) {
    console.error('[worklet] error:', err);
    res.status(500).json({ error: err.message || 'worklet generation failed' });
  }
});

// ---------- Tab 4: Action Items ----------
const memoryActionItems = new Map(); // file_id -> card

async function readActionItemCards(part) {
  if (supabase) {
    const { data, error } = await supabase
      .from('action_items')
      .select('*')
      .contains('accessible_to', [part])
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('action_items read error:', error.message);
    } else {
      return data || [];
    }
  }
  return Array.from(memoryActionItems.values())
    .filter((c) => c.accessible_to.includes(part))
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
}

// Cards relevant to a given user: any card where the user is the assigner
// OR is an assignee on at least one item.
async function readUserActionItemCards(userId) {
  let all = [];
  if (supabase) {
    const { data, error } = await supabase
      .from('action_items').select('*').order('created_at', { ascending: false });
    if (error) {
      console.warn('action_items read error:', error.message);
      all = Array.from(memoryActionItems.values());
    } else {
      all = data || [];
    }
  } else {
    all = Array.from(memoryActionItems.values());
  }
  return all
    .filter((c) =>
      c.assigned_by === userId ||
      (c.items || []).some((it) => Array.isArray(it.assignees) && it.assignees.includes(userId))
    )
    .map((c) => {
      const role = c.assigned_by === userId ? 'assigner' : 'assignee';
      const items = (c.items || []).map((it) => {
        const assignees = Array.isArray(it.assignees) ? it.assignees : [];
        const editable = assignees.includes(userId);
        return { ...it, assignees, editable };
      });
      return { ...c, items, viewer_role: role };
    });
}

async function upsertActionItemCard(card) {
  memoryActionItems.set(card.file_id, card);
  if (supabase) {
    const { error } = await supabase.from('action_items').upsert({
      id: card.id,
      file_id: card.file_id,
      filename: card.filename,
      accessible_to: card.accessible_to,
      assigned_by: card.assigned_by || null,
      items: card.items,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error('action_items upsert error:', error.message);
      throw new Error('action_items upsert failed: ' + error.message);
    }
  }
}

async function deleteActionItemCard(id) {
  for (const [key, val] of memoryActionItems) {
    if (val.id === id) { memoryActionItems.delete(key); break; }
  }
  if (supabase) {
    const { error } = await supabase.from('action_items').delete().eq('id', id);
    if (error) console.warn('action_items delete error:', error.message);
  }
}

// Returns the raw extracted items for review — does NOT save.
// Items at this stage have shape { id, text, completed:false, assignees:[] }.
async function extractItemsForReview(fileRow, fullText, cfg) {
  console.log(`[action-items] extracting from "${fileRow.filename}" (${fullText.length} chars)…`);
  const items = await extractActionItems(fullText, cfg.models.enrichment);
  // extractActionItems already returns objects with id/text/completed; ensure assignees field.
  const withAssignees = items.map((it) => ({ ...it, assignees: [] }));
  console.log(`[action-items] extracted ${withAssignees.length} items from "${fileRow.filename}"`);
  return withAssignees;
}

// Re-extract items from an already-uploaded file for REVIEW — does not save.
// Returns { file_id, filename, accessible_to, items: [...] }.
app.post('/api/action-items/extract/:file_id', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { file_id } = req.params;
  try {
    const { data: fileRow, error: fileErr } = await supabase
      .from('files').select('*').eq('id', file_id).maybeSingle();
    if (fileErr) throw fileErr;
    if (!fileRow) return res.status(404).json({ error: 'file not found' });

    const { data: chunks, error: chunkErr } = await supabase
      .from('chunks').select('chunk_text').eq('file_id', file_id).order('chunk_index');
    if (chunkErr) throw chunkErr;
    const fullText = (chunks || []).map((c) => c.chunk_text || '').join('\n\n');
    if (!fullText.trim()) {
      return res.status(422).json({ error: 'No chunk text available for this file' });
    }

    const items = await extractItemsForReview(fileRow, fullText, config);
    res.json({
      file_id: fileRow.id,
      filename: fileRow.filename,
      accessible_to: fileRow.accessible_to,
      items,
    });
  } catch (err) {
    console.error('[action-items] extract error:', err);
    res.status(500).json({ error: err.message || 'extraction failed' });
  }
});

// Save a reviewed-and-assigned action-items card.
// Body: { file_id, filename, accessible_to, assigned_by, items: [{id?, text, assignees}] }
app.post('/api/action-items', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { file_id, filename, accessible_to, assigned_by, items } = req.body || {};
  if (!file_id || !filename || !assigned_by || !Array.isArray(items)) {
    return res.status(400).json({ error: 'file_id, filename, assigned_by, items required' });
  }
  try {
    // Drop any pre-existing card for this file so save replaces (not duplicates).
    await supabase.from('action_items').delete().eq('file_id', file_id);
    const cleanItems = items
      .filter((it) => it && it.text?.trim())
      .map((it) => ({
        id: it.id || randomUUID(),
        text: it.text.trim(),
        completed: !!it.completed,
        assignees: Array.isArray(it.assignees) ? it.assignees.filter(Boolean) : [],
      }));
    if (cleanItems.length === 0) {
      return res.status(400).json({ error: 'no items to save' });
    }
    const card = {
      id: randomUUID(),
      file_id,
      filename,
      accessible_to: Array.isArray(accessible_to) ? accessible_to : [],
      assigned_by,
      items: cleanItems,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await upsertActionItemCard(card);
    res.status(201).json({ card });
  } catch (err) {
    console.error('[action-items] save error:', err);
    res.status(500).json({ error: err.message || 'save failed' });
  }
});

app.get('/api/action-items', async (req, res) => {
  const { part, user_id } = req.query;
  if (!part && !user_id) {
    return res.status(400).json({ error: 'part or user_id query param is required' });
  }
  try {
    if (user_id) {
      const cards = await readUserActionItemCards(user_id);
      return res.json({ cards });
    }
    const cards = await readActionItemCards(part);
    res.json({ cards });
  } catch (err) {
    console.error('[action-items] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Item-level patch — caller must be an assignee on the targeted item.
// Body: { user_id, item_id, completed?, text? }
app.patch('/api/action-items/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, item_id, completed, text } = req.body || {};
  if (!user_id || !item_id) {
    return res.status(400).json({ error: 'user_id and item_id required' });
  }
  try {
    let card = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('action_items').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      card = data;
    } else {
      for (const v of memoryActionItems.values()) if (v.id === id) { card = v; break; }
    }
    if (!card) return res.status(404).json({ error: 'card not found' });

    const items = (card.items || []).slice();
    const idx = items.findIndex((it) => it.id === item_id);
    if (idx < 0) return res.status(404).json({ error: 'item not found' });
    const target = items[idx];
    const assignees = Array.isArray(target.assignees) ? target.assignees : [];
    if (!assignees.includes(user_id)) {
      return res.status(403).json({ error: 'only assignees can edit this item' });
    }
    const next = { ...target };
    if (typeof completed === 'boolean') next.completed = completed;
    if (typeof text === 'string' && text.trim()) next.text = text.trim();
    items[idx] = next;

    const updatedCard = { ...card, items, updated_at: new Date().toISOString() };
    if (supabase) {
      const { error } = await supabase
        .from('action_items').update({ items, updated_at: updatedCard.updated_at }).eq('id', id);
      if (error) throw error;
    }
    memoryActionItems.set(updatedCard.file_id, updatedCard);
    res.json({ card: updatedCard });
  } catch (err) {
    console.error('[action-items] patch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/action-items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await deleteActionItemCard(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[action-items] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Shared: parts list ----------
app.get('/api/parts', (_req, res) => {
  res.json({ parts: config.parts || [] });
});

// User-scoped visibility:
//   - MD: sees everything (no scope filter)
//   - PartHead / Member with a part: sees files where accessible_to contains that part
//   - TeamHead / Member with a team: sees files where accessible_to contains that team
// Returns { scope: string|null, isAll: boolean }. scope=null + isAll=true means MD.
function userScope(user) {
  if (!user) return { scope: null, isAll: false };
  if (user.role === 'MD') return { scope: null, isAll: true };
  return { scope: user.part || user.team || null, isAll: false };
}

// ---------- Tab 2: list uploaded files ----------
app.get('/api/files', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const userId = req.query.user_id;
  const part = req.query.part;
  try {
    let q = supabase.from('files').select('*').order('uploaded_at', { ascending: false });
    if (userId) {
      const user = await loadUser(userId);
      if (!user) return res.status(400).json({ error: 'unknown user' });
      const { scope, isAll } = userScope(user);
      if (!isAll) {
        if (!scope) return res.json({ files: [] });
        q = q.contains('accessible_to', [scope]);
      }
    } else if (part) {
      q = q.contains('accessible_to', [part]);
    }
    const { data, error } = await q;
    if (error) throw error;
    res.json({ files: data });
  } catch (err) {
    console.error('list files error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Tab 2: delete file (cascades to chunks + action_items) ----------
app.delete('/api/files/:id', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  try {
    // Fetch the file row so we know the storage path.
    const { data: fileRow, error: fetchErr } = await supabase
      .from('files').select('id, file_url').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!fileRow) return res.status(404).json({ error: 'file not found' });

    // Delete the original from Storage (best-effort).
    if (fileRow.file_url) {
      const path = fileRow.file_url.split('/documents/')[1];
      if (path) {
        const { error: storageErr } = await supabase.storage.from('documents').remove([path]);
        if (storageErr) console.warn('[delete] storage remove failed:', storageErr.message);
      }
    }

    // Delete the row — chunks and action_items cascade via ON DELETE CASCADE.
    const { error: deleteErr } = await supabase.from('files').delete().eq('id', id);
    if (deleteErr) throw deleteErr;

    // Clear in-memory action-item cache for this file.
    for (const [key, val] of memoryActionItems) {
      if (val.file_id === id) memoryActionItems.delete(key);
    }
    console.log(`[delete] file ${id} removed (chunks + action items cascaded)`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[delete] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Tab 2: Upload + ingest ----------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // The uploader is identified by user_id; their part/team determines who else
  // can see this file. MD uploads are visible to everyone (all parts + teams).
  const userId = req.body.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  const uploader = await loadUser(userId);
  if (!uploader) return res.status(400).json({ error: 'unknown user' });

  let accessibleTo;
  if (uploader.role === 'MD') {
    // Allow MD to upload to any subset, falling back to "everyone".
    let raw = req.body.accessible_to;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = [raw]; }
    }
    accessibleTo = Array.isArray(raw) && raw.length
      ? raw
      : [...(config.parts || []), 'Team 1', 'Team 2', 'Team 3'];
  } else {
    const scope = uploader.part || uploader.team;
    if (!scope) return res.status(400).json({ error: 'uploader has no part/team' });
    accessibleTo = [scope];
  }
  const uploadedBy = uploader.name;
  // Opt-in flag: only extract action items if the uploader explicitly asked for it.
  const extractActions = req.body.extract_action_items === 'true' || req.body.extract_action_items === true;

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
    let pendingItems = null;
    if (extractActions) {
      try {
        const items = await extractItemsForReview(fileRow, extracted.text, config);
        pendingItems = {
          file_id: fileRow.id,
          filename: fileRow.filename,
          accessible_to: fileRow.accessible_to,
          items,
        };
      } catch (err) {
        console.warn('[action-items] extraction failed:', err.message);
      }
    }
    res.json({
      success: true,
      file_id: fileRow.id,
      chunk_count: inserted,
      pending_action_items: pendingItems,
    });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message || 'upload failed' });
  }
});

// ---------- Tab 2/3: Retrieve ----------
async function retrieve({ query, partFilter }) {
  const ready = ragReady();
  if (!ready.ok) {
    const e = new Error(`RAG not configured: missing ${ready.missing.join(', ')}`);
    e.status = 503;
    throw e;
  }
  const queryEmbedding = await embedText(query, config.embeddingModel, 'query');

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    part_filter: partFilter,
    match_count: config.rag.vector_search_top_k,
  });
  if (error) throw new Error('vector search failed: ' + error.message);
  if (!data || data.length === 0) return [];

  const reranked = await rerankChunks(query, data, config.models.reranker);
  return reranked.slice(0, config.rag.rerank_top_n);
}

// Resolve the access-scope filter for a request from `user_id` (preferred) or
// the legacy `part` body field. Returns string|null (null = unrestricted).
async function resolvePartFilter({ user_id, part }) {
  if (user_id) {
    const user = await loadUser(user_id);
    if (!user) {
      const e = new Error('unknown user');
      e.status = 400;
      throw e;
    }
    const { scope, isAll } = userScope(user);
    if (isAll) return null;
    if (!scope) {
      const e = new Error('user has no part/team scope');
      e.status = 400;
      throw e;
    }
    return scope;
  }
  return part || null;
}

app.post('/api/retrieve', async (req, res) => {
  const { query, part, user_id } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query is required' });
  try {
    const partFilter = await resolvePartFilter({ user_id, part });
    const chunks = await retrieve({ query, partFilter });
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
  const { query, part, user_id, conversation_history } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query is required' });
  try {
    const partFilter = await resolvePartFilter({ user_id, part });
    const chunks = await retrieve({ query, partFilter });

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

// ---------- Report Generator ----------
const REPORT_SYSTEM = `You are a report-writing assistant. You will be given:
1. A TEMPLATE — example structure showing how the user wants reports formatted
2. INPUT DATA — facts, notes, or context the user wants written up

Your job:
- Produce a complete report that follows the template's STRUCTURE, TONE, and FORMATTING (headings, sections, bullet points, table styles, length).
- Replace the template's example/placeholder content with the user's actual input data.
- Keep the same section ordering and formatting conventions as the template.
- Output as clean Markdown (use #, ##, ###, **bold**, lists, tables).
- Do not invent facts not present in the input data — if a section can't be filled, write "(not provided)".

Return ONLY the report. No preamble, no commentary.`;

app.get('/api/report-templates', async (_req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  try {
    const { data, error } = await supabase
      .from('report_templates')
      .select('id, filename, filetype, file_url, uploaded_by, uploaded_at')
      .order('uploaded_at', { ascending: false });
    if (error) throw error;
    res.json({ templates: data });
  } catch (err) {
    console.error('[report-templates] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/report-templates', upload.single('file'), async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const uploadedBy = req.body.uploaded_by;
  if (!uploadedBy) return res.status(400).json({ error: 'uploaded_by is required' });

  const filename = req.file.originalname;
  const ext = extname(filename).slice(1).toLowerCase();
  const filetype = req.file.mimetype || ext;
  console.log(`\n[template] ${filename} (${filetype}) by ${uploadedBy}`);

  try {
    const extracted = await extractText(req.file.buffer, filetype);
    if (!extracted.text || extracted.text.trim().length < 30) {
      return res.status(422).json({ error: 'No extractable text in template file' });
    }
    const storagePath = `templates/${randomUUID()}-${filename.replace(/[^\w.\-]+/g, '_')}`;
    const { error: storageErr } = await supabase
      .storage.from('documents')
      .upload(storagePath, req.file.buffer, { contentType: filetype, upsert: false });
    if (storageErr) throw new Error('storage upload failed: ' + storageErr.message);
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(storagePath);

    const { data: row, error: insErr } = await supabase
      .from('report_templates')
      .insert({
        filename,
        filetype: ext || filetype,
        file_url: pub.publicUrl,
        template_text: extracted.text.slice(0, 60000),
        uploaded_by: uploadedBy,
      })
      .select()
      .single();
    if (insErr) throw insErr;
    console.log(`[template] saved id=${row.id}`);
    res.json({ template: row });
  } catch (err) {
    console.error('[template] upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/report-templates/:id', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  try {
    const { data: row, error: fetchErr } = await supabase
      .from('report_templates').select('id, file_url').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row) return res.status(404).json({ error: 'template not found' });
    if (row.file_url) {
      const path = row.file_url.split('/documents/')[1];
      if (path) {
        const { error: stErr } = await supabase.storage.from('documents').remove([path]);
        if (stErr) console.warn('[template-delete] storage remove failed:', stErr.message);
      }
    }
    const { error: delErr } = await supabase.from('report_templates').delete().eq('id', id);
    if (delErr) throw delErr;
    res.json({ ok: true });
  } catch (err) {
    console.error('[template-delete] error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/report-templates/:id/generate', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  const { input_data } = req.body || {};
  if (!input_data || !input_data.trim()) {
    return res.status(400).json({ error: 'input_data is required' });
  }
  try {
    const { data: tmpl, error: fetchErr } = await supabase
      .from('report_templates').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!tmpl) return res.status(404).json({ error: 'template not found' });

    const userMsg = `--- TEMPLATE (${tmpl.filename}) ---\n${tmpl.template_text}\n\n--- INPUT DATA ---\n${input_data}`;
    const report = await generateText({
      model: config.models.summarisation,
      system: REPORT_SYSTEM,
      user: userMsg,
      maxTokens: 4096,
    });
    res.json({ report, template_filename: tmpl.filename });
  } catch (err) {
    console.error('[report-generate] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Minutes of Meeting ----------
const memoryMinutes = new Map();

const MOM_PARSE_SYSTEM = `You are a meeting assistant. Parse the transcript into structured meeting minutes.
Return ONLY a valid JSON object — no markdown fences, no extra fields:
{
  "title": "short meeting title inferred from context, or 'Meeting — YYYY-MM-DD'",
  "summary": "2-3 sentence executive summary of what was discussed and decided",
  "attendees": ["names mentioned as present, if any"],
  "decisions": ["each key decision made, as a complete sentence"],
  "action_items": [{"text": "action item description", "owner": "person responsible or null"}]
}`;

app.post('/api/minutes/transcribe', (req, res, next) => {
  upload.single('audio')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload error' });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio file required' });
  try {
    const base64 = req.file.buffer.toString('base64');
    const mimeType = (req.file.mimetype || 'audio/webm').split(';')[0];
    const transcript = await generateWithParts({
      model: config.models.summarisation,
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: 'Transcribe this audio recording verbatim. Output only the spoken words — no timestamps, no labels, no commentary.' },
      ],
      maxTokens: 8192,
    });
    res.json({ transcript });
  } catch (err) {
    console.error('[mom-transcribe]', err);
    res.status(500).json({ error: err.message || 'transcription failed' });
  }
});

app.post('/api/minutes/parse', async (req, res) => {
  const { transcript } = req.body || {};
  if (!transcript?.trim()) return res.status(400).json({ error: 'transcript required' });
  try {
    const raw = await generateText({
      model: config.models.summarisation,
      system: MOM_PARSE_SYSTEM,
      user: `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nTranscript:\n\n${transcript.slice(0, 20000)}`,
      maxTokens: 2048,
      jsonMode: true,
      // thinking intentionally disabled — combining thinking with jsonMode on Vertex AI
      // causes thinking parts to leak into the output, breaking JSON.parse
    });
    // Strip markdown fences if the model wraps its output despite jsonMode
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const minutes = JSON.parse(cleaned);
    res.json({ minutes });
  } catch (err) {
    console.error('[mom-parse]', err);
    res.status(500).json({ error: err.message || 'parsing failed' });
  }
});

app.get('/api/minutes', (_req, res) => {
  const list = Array.from(memoryMinutes.values())
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  res.json({ minutes: list });
});

app.post('/api/minutes', (req, res) => {
  const { title, summary, attendees, decisions, action_items, transcript } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const id = randomUUID();
  const record = {
    id,
    title,
    summary: summary || '',
    attendees: attendees || [],
    decisions: decisions || [],
    action_items: action_items || [],
    transcript: transcript || '',
    created_at: new Date().toISOString(),
  };
  memoryMinutes.set(id, record);
  res.status(201).json({ minute: record });
});

app.delete('/api/minutes/:id', (req, res) => {
  const { id } = req.params;
  if (!memoryMinutes.has(id)) return res.status(404).json({ error: 'not found' });
  memoryMinutes.delete(id);
  res.json({ ok: true });
});

// ---------- Render markdown to .docx ----------
import { marked } from 'marked';
import HTMLtoDOCX from 'html-to-docx';

app.post('/api/render-docx', async (req, res) => {
  const { markdown, filename = 'report.docx' } = req.body || {};
  if (!markdown || !markdown.trim()) {
    return res.status(400).json({ error: 'markdown is required' });
  }
  try {
    const html = await marked.parse(markdown);
    // Wrap with minimal HTML so html-to-docx gets a valid document.
    const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    let out = await HTMLtoDOCX(wrapped, null, {
      orientation: 'portrait',
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      table: { row: { cantSplit: true } },
      font: 'Calibri',
      fontSize: 22, // half-points (=11pt)
    });
    // html-to-docx can return a Blob, ArrayBuffer, or Buffer depending on
    // version/runtime. Normalise to a Buffer so res.send sends the exact
    // binary (and sets Content-Length correctly) — otherwise Word reports
    // the file as corrupt.
    if (!Buffer.isBuffer(out)) {
      if (typeof out?.arrayBuffer === 'function') {
        out = Buffer.from(await out.arrayBuffer());
      } else if (out instanceof ArrayBuffer) {
        out = Buffer.from(out);
      } else if (ArrayBuffer.isView(out)) {
        out = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
      } else {
        throw new Error('html-to-docx returned an unsupported type: ' + typeof out);
      }
    }
    const safeName = String(filename).replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(out);
  } catch (err) {
    console.error('[render-docx] error:', err);
    res.status(500).json({ error: err.message || 'docx render failed' });
  }
});

// ---------- Users ----------
app.get('/api/users', async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('role', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ users: data || [] });
  } catch (err) {
    console.error('[users] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Task Forces ----------
function userIsTechMgmtHead(u) {
  return u && u.role === 'PartHead' && u.part === 'Tech Management';
}
function userCanSeeAllTFs(u) {
  return !!u && (u.role === 'MD' || userIsTechMgmtHead(u));
}
function userCanCreateTF(u) {
  return !!u && (u.role === 'MD' || u.role === 'PartHead' || u.role === 'TeamHead');
}
function userIsOwner(u, tf) {
  return !!u && Array.isArray(tf.owners) && tf.owners.includes(u.id);
}
function userCanEditTF(u, tf) {
  // Log update / add action item permission
  if (!u || !tf) return false;
  if (u.role === 'MD') return true;
  if ((u.role === 'PartHead' || u.role === 'TeamHead') && userIsOwner(u, tf)) return true;
  return false;
}
function userCanSeeTF(u, tf) {
  if (!u) return false;
  if (userCanSeeAllTFs(u)) return true;
  return userIsOwner(u, tf) || (Array.isArray(tf.members) && tf.members.includes(u.id));
}

async function loadUser(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadTfFull(id) {
  const { data: tf, error } = await supabase
    .from('task_forces').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!tf) return null;
  const [{ data: updates, error: uErr }, { data: items, error: aErr }] = await Promise.all([
    supabase.from('tf_updates').select('*').eq('tf_id', id).order('created_at', { ascending: false }),
    supabase.from('tf_action_items').select('*').eq('tf_id', id).order('created_at', { ascending: true }),
  ]);
  if (uErr) throw uErr;
  if (aErr) throw aErr;
  return { ...tf, updates: updates || [], actionItems: items || [] };
}

// Compute auto co-owners: heads of every selected part/team.
async function autoOwnersForScope(parts, teams) {
  const owners = new Set();
  if (parts && parts.length) {
    const { data, error } = await supabase
      .from('users').select('id').eq('role', 'PartHead').in('part', parts);
    if (error) throw error;
    for (const r of data || []) owners.add(r.id);
  }
  if (teams && teams.length) {
    const { data, error } = await supabase
      .from('users').select('id').eq('role', 'TeamHead').in('team', teams);
    if (error) throw error;
    for (const r of data || []) owners.add(r.id);
  }
  return Array.from(owners);
}

app.get('/api/task-forces', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const userId = req.query.user_id;
  try {
    const user = await loadUser(userId);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });

    const { data: tfs, error } = await supabase
      .from('task_forces').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const visible = (tfs || []).filter((tf) => userCanSeeTF(user, tf));
    const ids = visible.map((t) => t.id);
    let updates = [], items = [];
    if (ids.length) {
      const [u, a] = await Promise.all([
        supabase.from('tf_updates').select('*').in('tf_id', ids).order('created_at', { ascending: false }),
        supabase.from('tf_action_items').select('*').in('tf_id', ids).order('created_at', { ascending: true }),
      ]);
      if (u.error) throw u.error;
      if (a.error) throw a.error;
      updates = u.data || [];
      items = a.data || [];
    }
    const result = visible.map((tf) => ({
      ...tf,
      updates: updates.filter((x) => x.tf_id === tf.id),
      actionItems: items.filter((x) => x.tf_id === tf.id),
    }));
    res.json({ task_forces: result });
  } catch (err) {
    console.error('[tf] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-forces', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { user_id, name, status, parts = [], teams = [], members = [] } = req.body || {};
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    if (!userCanCreateTF(user)) return res.status(403).json({ error: 'not permitted' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

    const autoOwners = await autoOwnersForScope(parts, teams);
    // Creator is always an owner; auto-include heads of selected parts/teams.
    const owners = Array.from(new Set([user.id, ...autoOwners]));
    const { data, error } = await supabase
      .from('task_forces')
      .insert({
        name: name.trim(),
        status: status || 'Active',
        parts, teams, owners, members,
        created_by: user.id,
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ task_force: { ...data, updates: [], actionItems: [] } });
  } catch (err) {
    console.error('[tf] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/task-forces/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const { user_id, status } = req.body || {};
  if (!status || !['Active', 'On Hold', 'Closed'].includes(status)) {
    return res.status(400).json({ error: 'status must be Active | On Hold | Closed' });
  }
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const tf = await loadTfFull(id);
    if (!tf) return res.status(404).json({ error: 'not found' });
    if (!userCanEditTF(user, tf)) return res.status(403).json({ error: 'not permitted' });

    const { data, error } = await supabase
      .from('task_forces')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single();
    if (error) throw error;
    res.json({ task_force: data });
  } catch (err) {
    console.error('[tf] status update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/task-forces/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const userId = req.query.user_id || req.body?.user_id;
  try {
    const user = await loadUser(userId);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    if (!userCanCreateTF(user)) return res.status(403).json({ error: 'not permitted' });

    if (user.role !== 'MD') {
      const { data: tf, error } = await supabase
        .from('task_forces').select('owners').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!tf) return res.status(404).json({ error: 'not found' });
      if (!tf.owners?.includes(user.id)) {
        return res.status(403).json({ error: 'only owners or MD can delete' });
      }
    }
    const { error: delErr } = await supabase.from('task_forces').delete().eq('id', id);
    if (delErr) throw delErr;
    res.json({ ok: true });
  } catch (err) {
    console.error('[tf] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-forces/:id/updates', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const { user_id, type, content } = req.body || {};
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const tf = await loadTfFull(id);
    if (!tf) return res.status(404).json({ error: 'not found' });
    if (!userCanEditTF(user, tf)) return res.status(403).json({ error: 'not permitted' });
    if (!type || !content?.trim()) return res.status(400).json({ error: 'type and content required' });

    const { data, error } = await supabase
      .from('tf_updates')
      .insert({ tf_id: id, type, author: user.id, content: content.trim() })
      .select().single();
    if (error) throw error;
    res.status(201).json({ update: data });
  } catch (err) {
    console.error('[tf] update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-forces/:id/action-items', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const { user_id, text, assignee, due } = req.body || {};
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const tf = await loadTfFull(id);
    if (!tf) return res.status(404).json({ error: 'not found' });
    if (!userCanEditTF(user, tf)) return res.status(403).json({ error: 'not permitted' });
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    const { data, error } = await supabase
      .from('tf_action_items')
      .insert({ tf_id: id, text: text.trim(), assignee: assignee || null, due: due || null, done: false })
      .select().single();
    if (error) throw error;
    res.status(201).json({ action_item: data });
  } catch (err) {
    console.error('[tf] action-item create error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/task-forces/:id/action-items/:aid', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id, aid } = req.params;
  const { user_id, done, comment } = req.body || {};
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const tf = await loadTfFull(id);
    if (!tf) return res.status(404).json({ error: 'not found' });

    const item = tf.actionItems.find((a) => a.id === aid);
    if (!item) return res.status(404).json({ error: 'action item not found' });

    const isAssignee = item.assignee === user.id;
    const canToggle = user.role === 'MD' || userIsOwner(user, tf) || isAssignee;
    if (!canToggle) return res.status(403).json({ error: 'not permitted' });

    const newDone = typeof done === 'boolean' ? done : !item.done;
    const { data: updated, error } = await supabase
      .from('tf_action_items').update({ done: newDone }).eq('id', aid).select().single();
    if (error) throw error;

    let logged = null;
    // When marking complete, log an ACTION_ITEM update with the user's comment.
    if (newDone && !item.done) {
      const cleanComment = (comment || '').trim();
      const updateContent = `${user.name} completed action item: ${cleanComment || item.text}`;
      const { data: up, error: upErr } = await supabase
        .from('tf_updates')
        .insert({ tf_id: id, type: 'ACTION_ITEM', author: user.id, content: updateContent })
        .select().single();
      if (upErr) throw upErr;
      logged = up;
    }
    res.json({ action_item: updated, update: logged });
  } catch (err) {
    console.error('[tf] action-item patch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rag: ragReady() }));

if (process.env.NODE_ENV === 'production') {
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(join(__dirname, 'client', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
