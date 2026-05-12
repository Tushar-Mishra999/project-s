import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { google } from 'googleapis';

// Write Vertex AI service account JSON to a temp file so ADC picks it up.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credPath = join(tmpdir(), 'gcp-sa-key.json');
  writeFileSync(credPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
}

import { supabase, ragReady, voyage } from './lib/clients.js';
import { initConstraints, neo4jReady } from './lib/neo4j.js';
import { extractEntities, writeDocumentToGraph, deleteDocumentFromGraph, graphSearch, routeQuery } from './lib/graphExtract.js';
import { generateChat, generateChatGemma, generateChatGLM, generateChatKimi, generateText, generateWithParts, generateTextWithSearch } from './lib/llm.js';
import { runFeedPipeline } from './lib/feed.js';
import { extractActionItems } from './lib/actionItems.js';
import { extractText } from './lib/extract.js';
import { chunkDocument, addContextPrefix } from './lib/chunk.js';
import {
  enrichChunk,
  embedText,
  buildEmbeddingInput,
  rerankChunks,
  stripJsonFences,
} from './lib/rag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

const PORT = process.env.PORT || 3001;
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON in .env');
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
// Cache strategy: per-part. Each part runs and stores its own feed
// independently; refreshing as PMO doesn't wipe TM's cache.
// GET  /api/feed?part=X         -> return cached payload for that part
// POST /api/feed/refresh        -> run only the sources tagged for the
//                                  caller's part, overwrite that cache
const memoryFeedCache = new Map();   // part -> payload
const pipelineRunning = new Set();   // set of parts currently being scraped

function cacheId(part) {
  return part ? `part:${part}` : 'latest';
}

async function readFeedCache(part) {
  const key = cacheId(part);
  if (supabase) {
    const { data, error } = await supabase
      .from('feed_cache')
      .select('data, generated_at')
      .eq('id', key)
      .maybeSingle();
    if (error) {
      console.warn('feed_cache read error:', error.message);
      return memoryFeedCache.get(key) || null;
    }
    const fromDB = data ? { ...data.data, generatedAt: data.generated_at } : null;
    const fromMem = memoryFeedCache.get(key);
    if (fromMem && (!fromDB || fromMem.generatedAt > fromDB.generatedAt)) {
      return fromMem;
    }
    return fromDB;
  }
  return memoryFeedCache.get(key) || null;
}

async function writeFeedCache(part, payload) {
  const key = cacheId(part);
  memoryFeedCache.set(key, payload);
  if (supabase) {
    const { error } = await supabase
      .from('feed_cache')
      .upsert({
        id: key,
        data: payload,
        generated_at: payload.generatedAt,
        updated_at: new Date().toISOString(),
      });
    if (error) console.warn('feed_cache write error:', error.message);
  }
}

app.get('/api/feed', async (req, res) => {
  const part = req.query.part || null;
  const cached = await readFeedCache(part);
  res.json({
    ...(cached || { sources: {}, count: 0, generatedAt: null }),
    pipelineRunning: pipelineRunning.has(cacheId(part)),
  });
});

app.get('/api/feed/sources', (req, res) => {
  const cfg = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
  const part = req.query.part;
  const sources = part
    ? cfg.sources.filter((s) => Array.isArray(s.parts) ? s.parts.includes(part) : part === 'Tech Management')
    : cfg.sources;
  res.json({ sources });
});

app.post('/api/feed/sources', (req, res) => {
  const { name, url, parts } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  const cfgPath = join(__dirname, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  if (cfg.sources.some(s => s.name === name)) {
    return res.status(409).json({ error: 'A source with that name already exists' });
  }
  const partsArr = Array.isArray(parts) && parts.length ? parts : ['Tech Management'];
  cfg.sources.push({ name, url, parts: partsArr });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.sources = cfg.sources;
  res.json({ sources: cfg.sources });
});

app.post('/api/feed/refresh', (req, res) => {
  const part = (req.body && req.body.part) || req.query.part || null;
  const key = cacheId(part);
  if (pipelineRunning.has(key)) return res.status(202).json({ status: 'running' });
  pipelineRunning.add(key);
  const started = Date.now();

  // Re-read config from disk so changes to config.json take effect without restart.
  const liveConfig = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

  // Scope sources to the requested part. If no part given, run everything
  // (back-compat for any caller that hasn't migrated yet).
  const scoped = {
    ...liveConfig,
    part,
    sources: part
      ? liveConfig.sources.filter((s) =>
          Array.isArray(s.parts)
            ? s.parts.includes(part)
            : part === 'Tech Management')
      : liveConfig.sources,
    maxItemsPerSource: (part != null && liveConfig.maxItemsPerSourceByPart?.[part] != null)
      ? liveConfig.maxItemsPerSourceByPart[part]
      : liveConfig.maxItemsPerSource,
  };

  console.log(`\n=== /api/feed/refresh part=${part || '(all)'} sources=${scoped.sources.length} at ${new Date().toISOString()} ===`);
  runFeedPipeline(scoped)
    .then(async ({ grouped, total, errors = [] }) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[${part || 'all'}] Done in ${elapsed}s. ${total} items / ${Object.keys(grouped).length} sources. ${errors.length} errors.`);
      const payload = {
        generatedAt: new Date().toISOString(),
        part,
        count: total,
        sources: grouped,
        errors,
      };
      await writeFeedCache(part, payload);
    })
    .catch((err) => {
      console.error(`[${part || 'all'}] feed pipeline error:`, err);
    })
    .finally(() => {
      pipelineRunning.delete(key);
    });
  res.status(202).json({ status: 'started', part });
});

// ---------- Open Source Leaderboard ----------
let leaderboardCache = { data: null, fetchedAt: null };
const LEADERBOARD_TTL = 3600000; // 1 hour

app.get('/api/leaderboard', async (req, res) => {
  try {
    // Return in-memory cache if fresh
    if (leaderboardCache.data && leaderboardCache.fetchedAt && (Date.now() - leaderboardCache.fetchedAt < LEADERBOARD_TTL)) {
      console.log('[leaderboard] returning cached data');
      return res.json(leaderboardCache.data);
    }

    // Check Supabase cache before hitting Gemini
    if (supabase) {
      const { data: row } = await supabase.from('feed_cache').select('data, generated_at').eq('id', 'leaderboard').maybeSingle();
      if (row?.data && row.generated_at && (Date.now() - new Date(row.generated_at).getTime() < LEADERBOARD_TTL)) {
        console.log('[leaderboard] returning Supabase-cached data');
        leaderboardCache = { data: row.data, fetchedAt: new Date(row.generated_at).getTime() };
        return res.json(row.data);
      }
    }

    const prompt = `Search the current Open LLM Leaderboard tier rankings from onyx.app (https://onyx.app/open-llm-leaderboard).

Extract the tier-based model rankings for only 1 category: Overall.

Return a JSON array with this exact structure:
[
  {"tier": "S", "models": [{"name": "", "params": ""}]},
  {"tier": "A", "models": [{"name": "", "params": ""}]},
  {"tier": "B", "models": [{"name": "", "params": ""}]},
  {"tier": "C", "models": [{"name": "", "params": ""}]},
  {"tier": "D", "models": [{"name": "", "params": ""}]}
]

Each model object must have:
- "name": model name string
- "params": parameter count string like "744B", "1T", "27B" (or null if unknown)

Include all tiers S, A, B, C, D (empty models array if no models in that tier).
Return ONLY the JSON array, no markdown fences, no explanation, no extra text.`;

    console.log('[leaderboard] calling Gemini with Google Search grounding...');

    // Use generateContent directly for Google Search grounding
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });

    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        maxOutputTokens: 2500,
        systemInstruction: 'You are a data extraction assistant. Return only valid JSON objects. No markdown, no explanation.',
        tools: [{ googleSearch: {} }],
      },
    });

    // Debug: log the full response structure
    console.log('[leaderboard] response candidates count:', resp.candidates?.length);
    console.log('[leaderboard] finishReason:', resp.candidates?.[0]?.finishReason);

    // Extract text from response
    let rawText = '';
    if (resp.text && typeof resp.text === 'string') {
      rawText = resp.text;
    } else {
      const parts = resp.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        rawText = parts.map((p) => p.text || '').join('');
      }
    }
    rawText = rawText.trim();

    console.log('[leaderboard] raw response length:', rawText.length);
    console.log('[leaderboard] raw response (first 500 chars):', rawText.slice(0, 500));

    if (!rawText) {
      console.error('[leaderboard] empty response from Gemini');
      // Log grounding metadata if present
      const groundingMeta = resp.candidates?.[0]?.groundingMetadata;
      if (groundingMeta) {
        console.log('[leaderboard] grounding metadata:', JSON.stringify(groundingMeta).slice(0, 500));
      }
      return res.status(500).json({ error: 'Empty response from AI model' });
    }

    // Parse the JSON response — try multiple cleanup strategies
    let tiers;
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    console.log('[leaderboard] cleaned response (first 500 chars):', cleaned.slice(0, 500));

    try {
      tiers = JSON.parse(cleaned);
    } catch (e1) {
      console.warn('[leaderboard] direct parse failed:', e1.message);
      // Try extracting JSON array from the text
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        try {
          tiers = JSON.parse(arrMatch[0]);
          console.log('[leaderboard] extracted array from text, parsed OK');
        } catch (e2) {
          console.error('[leaderboard] array extraction parse also failed:', e2.message);
          console.error('[leaderboard] full cleaned text:', cleaned);
          return res.status(500).json({
            error: 'Failed to parse leaderboard data from AI',
            debug: { rawLength: rawText.length, preview: cleaned.slice(0, 300) },
          });
        }
      } else {
        console.error('[leaderboard] no JSON array found in response');
        console.error('[leaderboard] full cleaned text:', cleaned);
        return res.status(500).json({
          error: 'Failed to parse leaderboard data from AI — no JSON array in response',
          debug: { rawLength: rawText.length, preview: cleaned.slice(0, 300) },
        });
      }
    }

    if (!Array.isArray(tiers)) {
      console.error('[leaderboard] parsed result is not an array:', typeof tiers);
      return res.status(500).json({ error: 'AI returned unexpected data format' });
    }

    console.log(`[leaderboard] success — got ${tiers.length} tiers`);
    const now = new Date().toISOString();
    const payload = { tiers, fetchedAt: now };
    leaderboardCache = { data: payload, fetchedAt: Date.now() };
    if (supabase) {
      supabase.from('feed_cache').upsert({ id: 'leaderboard', data: payload, generated_at: now, updated_at: now }).then(({ error }) => {
        if (error) console.warn('[leaderboard] cache write error:', error.message);
      });
    }
    res.json(payload);
  } catch (err) {
    console.error('[leaderboard] error:', err.message);
    console.error('[leaderboard] stack:', err.stack?.slice(0, 500));
    res.status(500).json({ error: err.message || 'Failed to fetch leaderboard' });
  }
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

// ---------- Live Search ----------
app.post('/api/feed/live-search', async (req, res) => {
  const { query } = req.body || {};
  if (!query || !query.trim()) return res.status(400).json({ error: 'query is required' });

  try {
    const prompt = `Search for the 10 most recent and relevant news articles about: "${query.trim()}"

For each article return its title, URL, and a 1-2 sentence description of what it covers.

Return ONLY a valid JSON array, no markdown, no explanation:
[{"title":"...","url":"https://...","description":"...","source":"..."},...]`;

    const { text, groundingChunks } = await generateTextWithSearch({
      model: config.models.scoring,
      user: prompt,
      maxTokens: 6000,
    });

    console.log(`[live-search] query="${query}" chunks=${groundingChunks.length} textLen=${text.length}`);

    // 1. Try grounding chunks first — actual URLs Gemini retrieved
    if (groundingChunks.length > 0) {
      // Parse text for descriptions, fall back to chunk titles
      let descMap = {};
      try {
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          parsed.forEach((a) => {
            if (a.url) descMap[a.url] = { title: a.title || '', description: a.description || '', source: a.source || '' };
          });
        }
      } catch {}

      const articles = groundingChunks
        .map((c) => {
          const url = (c.web?.uri || '').trim();
          const meta = descMap[url] || {};
          return {
            title: (meta.title || c.web?.title || '').trim(),
            url,
            description: meta.description || '',
            source: meta.source || (url ? new URL(url).hostname.replace(/^www\./, '') : ''),
          };
        })
        .filter((a) => a.url && a.title)
        .slice(0, 10);

      if (articles.length > 0) return res.json({ articles });
    }

    // 2. Parse JSON text response
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const articles = parsed
          .map((a) => ({
            title: (a.title || '').trim(),
            url: (a.url || '').trim(),
            description: (a.description || '').trim(),
            source: a.source || (a.url ? new URL(a.url).hostname.replace(/^www\./, '') : ''),
          }))
          .filter((a) => a.title && a.url)
          .slice(0, 10);
        if (articles.length > 0) return res.json({ articles });
      }
    } catch {}

    res.json({ articles: [], warning: 'No results found. Try a different query.' });
  } catch (err) {
    console.error('[live-search] error:', err);
    res.status(500).json({ error: err.message || 'live search failed' });
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
  // Memory cache key: unique per manual card, file_id for file-sourced, source_id otherwise.
  const memKey = card.source_type === 'manual'
    ? `manual:${card.id}`
    : (card.file_id || `${card.source_type || 'file'}:${card.source_id}`);
  memoryActionItems.set(memKey, card);
  if (supabase) {
    const { error } = await supabase.from('action_items').upsert({
      id: card.id,
      file_id: card.file_id || null,
      filename: card.filename,
      accessible_to: card.accessible_to,
      assigned_by: card.assigned_by || null,
      items: card.items,
      source_type: card.source_type || 'file',
      source_id: card.source_id || null,
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
  const {
    file_id, filename, accessible_to, assigned_by, items,
    source_type, source_id,
  } = req.body || {};
  const sourceType = source_type || 'file';
  const isMomSource = sourceType === 'mom';
  const isManualSource = sourceType === 'manual';
  if (!filename || !assigned_by || !Array.isArray(items)) {
    return res.status(400).json({ error: 'filename, assigned_by, items required' });
  }
  if (!isMomSource && !isManualSource && !file_id) {
    return res.status(400).json({ error: 'file_id required for file-sourced action items' });
  }
  if (isMomSource && !source_id) {
    return res.status(400).json({ error: 'source_id required for MoM-sourced action items' });
  }
  try {
    // Replace prior card for the same source so saves are idempotent.
    // Manual cards are always new — no deduplication.
    if (isMomSource) {
      await supabase.from('action_items')
        .delete()
        .eq('source_type', 'mom')
        .eq('source_id', source_id);
    } else if (!isManualSource) {
      await supabase.from('action_items').delete().eq('file_id', file_id);
    }
    const cleanItems = items
      .filter((it) => it && it.text?.trim())
      .map((it) => ({
        id: it.id || randomUUID(),
        text: it.text.trim(),
        completed: !!it.completed,
        assignees: Array.isArray(it.assignees) ? it.assignees.filter(Boolean) : [],
        due_date: typeof it.due_date === 'string' && it.due_date ? it.due_date : null,
        parent_item_id: it.parent_item_id || null,
      }));
    if (cleanItems.length === 0) {
      return res.status(400).json({ error: 'no items to save' });
    }
    const newCardId = randomUUID();
    const card = {
      id: newCardId,
      file_id: (isMomSource || isManualSource) ? null : file_id,
      filename,
      accessible_to: Array.isArray(accessible_to) ? accessible_to : [],
      assigned_by,
      items: cleanItems,
      source_type: sourceType,
      source_id: isMomSource ? source_id : null,
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

// Item-level patch — update an item or add a sub-item.
// Update body: { user_id, item_id, completed?, text?, due_date?, parent_item_id? }
// Add sub-item body: { user_id, add_item: { text, assignees, parent_item_id, due_date? } }
app.patch('/api/action-items/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, item_id, completed, text, due_date, parent_item_id, add_item } = req.body || {};
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }
  if (!add_item && !item_id) {
    return res.status(400).json({ error: 'item_id or add_item required' });
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

    // ── Add a new sub-item ──────────────────────────────────
    if (add_item) {
      if (card.assigned_by !== user_id) {
        return res.status(403).json({ error: 'only the assigner can add sub-items' });
      }
      if (!add_item.text?.trim()) {
        return res.status(400).json({ error: 'add_item.text required' });
      }
      const newItem = {
        id: randomUUID(),
        text: add_item.text.trim(),
        completed: false,
        assignees: Array.isArray(add_item.assignees) ? add_item.assignees.filter(Boolean) : [user_id],
        due_date: typeof add_item.due_date === 'string' && add_item.due_date ? add_item.due_date : null,
        parent_item_id: add_item.parent_item_id || null,
      };
      const newItems = [...items, newItem];
      const updatedCard = { ...card, items: newItems, updated_at: new Date().toISOString() };
      if (supabase) {
        const { error } = await supabase
          .from('action_items').update({ items: newItems, updated_at: updatedCard.updated_at }).eq('id', id);
        if (error) throw error;
      }
      memoryActionItems.set(updatedCard.id, updatedCard);
      return res.json({ card: updatedCard });
    }

    // ── Update an existing item ─────────────────────────────
    const idx = items.findIndex((it) => it.id === item_id);
    if (idx < 0) return res.status(404).json({ error: 'item not found' });
    const target = items[idx];
    const assignees = Array.isArray(target.assignees) ? target.assignees : [];
    const isAssigner = card.assigned_by === user_id;
    if (!assignees.includes(user_id) && !isAssigner) {
      return res.status(403).json({ error: 'only assignees or the assigner can edit this item' });
    }
    const next = { ...target };
    if (typeof completed === 'boolean') next.completed = completed;
    if (typeof text === 'string' && text.trim()) next.text = text.trim();
    if (due_date === null) next.due_date = null;
    else if (typeof due_date === 'string' && due_date) next.due_date = due_date;
    if (typeof parent_item_id !== 'undefined') next.parent_item_id = parent_item_id || null;
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

// ---------- Tab 2: lock / unlock file (Library "Download & Edit") ----------
app.post('/api/files/:id/lock', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });
    const { data: file, error: fErr } = await supabase
      .from('files').select('id, locked_by_id, locked_by_name, locked_at').eq('id', id).maybeSingle();
    if (fErr) throw fErr;
    if (!file) return res.status(404).json({ error: 'file not found' });
    if (file.locked_by_id && file.locked_by_id !== user_id) {
      return res.status(409).json({
        error: `Locked by ${file.locked_by_name || 'another user'}`,
        locked_by_id: file.locked_by_id,
        locked_by_name: file.locked_by_name,
        locked_at: file.locked_at,
      });
    }
    const lockedAt = new Date().toISOString();
    const { data: updated, error: uErr } = await supabase
      .from('files')
      .update({ locked_by_id: user_id, locked_by_name: user.name, locked_at: lockedAt })
      .eq('id', id)
      .select()
      .single();
    if (uErr) throw uErr;
    res.json({ file: updated });
  } catch (err) {
    console.error('[files/lock] error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files/:id/unlock', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });
    const { data: file, error: fErr } = await supabase
      .from('files').select('id, locked_by_id').eq('id', id).maybeSingle();
    if (fErr) throw fErr;
    if (!file) return res.status(404).json({ error: 'file not found' });
    if (file.locked_by_id && file.locked_by_id !== user_id && user.role !== 'MD') {
      return res.status(403).json({ error: 'only the lock holder or MD can release this lock' });
    }
    const { data: updated, error: uErr } = await supabase
      .from('files')
      .update({ locked_by_id: null, locked_by_name: null, locked_at: null })
      .eq('id', id)
      .select()
      .single();
    if (uErr) throw uErr;
    res.json({ file: updated });
  } catch (err) {
    console.error('[files/unlock] error:', err);
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
    deleteDocumentFromGraph(id);
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
  const mimeType = req.file.mimetype || 'application/octet-stream';
  // Combine mime + extension so extract.js can match on either (e.g. generic mime + .xlsx ext)
  const filetype = `${mimeType} ${ext}`.trim();

  console.log(`\n[upload] ${filename} (${mimeType}) by ${uploadedBy} -> ${accessibleTo.join(',')}`);

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
        contentType: mimeType,
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

    // Graph indexing (best-effort, non-blocking)
    if (neo4jReady()) {
      extractEntities(extracted.text, config.models.chat).then((entities) =>
        writeDocumentToGraph({
          fileId: fileRow.id, filename, filetype: ext || filetype,
          fileUrl, uploadedBy, part: accessibleTo[0] || '',
          entities,
        })
      ).catch((err) => console.warn('[graph] indexing failed:', err.message));
    }

    // Auto-release any locks held by this user — uploading a new version
    // implies their edit session is finished.
    try {
      const { error: relErr } = await supabase
        .from('files')
        .update({ locked_by_id: null, locked_by_name: null, locked_at: null })
        .eq('locked_by_id', userId);
      if (relErr) console.warn('[upload] auto-release locks failed:', relErr.message);
    } catch (err) {
      console.warn('[upload] auto-release locks error:', err.message);
    }
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

// ---------- Library: replace file in place (new version) ----------
// Upload a fresh version of an existing file. Keeps the same files.id, bumps
// version, replaces storage object + chunks, releases lock. Caller must hold
// the lock (or be MD).
app.post('/api/files/:id/replace', upload.single('file'), async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { id } = req.params;
  const userId = req.body.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  try {
    const user = await loadUser(userId);
    if (!user) return res.status(400).json({ error: 'unknown user' });

    const { data: existing, error: exErr } = await supabase
      .from('files').select('*').eq('id', id).maybeSingle();
    if (exErr) throw exErr;
    if (!existing) return res.status(404).json({ error: 'file not found' });

    const isMD = user.role === 'MD';
    if (existing.locked_by_id && existing.locked_by_id !== userId && !isMD) {
      return res.status(403).json({
        error: `Locked by ${existing.locked_by_name || 'another user'}`,
      });
    }

    const newName = req.file.originalname;
    const ext = extname(newName).slice(1).toLowerCase();
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const filetype = `${mimeType} ${ext}`.trim();
    console.log(`\n[replace] file_id=${id} -> ${newName} (${mimeType}) by ${user.name}`);

    // 1. Extract new content
    const extracted = await extractText(req.file.buffer, filetype);
    if (!extracted.text || extracted.text.trim().length < 30) {
      return res.status(422).json({ error: 'No extractable text found in file' });
    }

    // 2. Chunk
    const rawChunks = chunkDocument(extracted, config.rag);
    const chunks = addContextPrefix(rawChunks);
    console.log(`[replace] ${chunks.length} chunks`);

    // 3. Upload new storage object
    const storagePath = `${randomUUID()}-${newName.replace(/[^\w.\-]+/g, '_')}`;
    const { error: storageErr } = await supabase
      .storage.from('documents')
      .upload(storagePath, req.file.buffer, { contentType: mimeType, upsert: false });
    if (storageErr) throw new Error('storage upload failed: ' + storageErr.message);
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(storagePath);
    const newFileUrl = pub.publicUrl;

    // 4. Best-effort delete of old storage object
    if (existing.file_url) {
      const oldPath = existing.file_url.split('/documents/')[1];
      if (oldPath) {
        const { error: rmErr } = await supabase.storage.from('documents').remove([oldPath]);
        if (rmErr) console.warn('[replace] old storage remove failed:', rmErr.message);
      }
    }

    // 5. Wipe existing chunks for this file
    const { error: delErr } = await supabase.from('chunks').delete().eq('file_id', id);
    if (delErr) throw new Error('failed to clear old chunks: ' + delErr.message);

    // 6. Update files row (preserve uploader, accessible_to; bump version, clear lock)
    const newVersion = (existing.version || 1) + 1;
    const nowIso = new Date().toISOString();
    const { data: updated, error: upErr } = await supabase
      .from('files')
      .update({
        filename: newName,
        filetype: ext || filetype,
        file_url: newFileUrl,
        version: newVersion,
        updated_by: user.name,
        updated_at: nowIso,
        locked_by_id: null,
        locked_by_name: null,
        locked_at: null,
      })
      .eq('id', id)
      .select()
      .single();
    if (upErr) throw upErr;

    // 7. Re-index chunks
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      let enriched = { summary: '', keywords: [], hypothetical_questions: [] };
      try {
        enriched = await enrichChunk(c.text, config.models.enrichment);
      } catch (err) {
        console.warn(`[replace] enrichment failed for chunk ${i}: ${err.message}`);
      }
      const embeddingInput = buildEmbeddingInput(enriched) || c.text.slice(0, 2000);
      let embedding;
      try {
        embedding = await embedText(embeddingInput, config.embeddingModel, 'document');
      } catch (err) {
        console.warn(`[replace] embed failed for chunk ${i}: ${err.message}`);
        continue;
      }
      const { error: chunkErr } = await supabase.from('chunks').insert({
        file_id: id,
        chunk_text: c.text,
        chunk_summary: enriched.summary,
        keywords: enriched.keywords,
        hypothetical_questions: enriched.hypothetical_questions,
        embedding,
        chunk_index: i,
      });
      if (chunkErr) console.warn(`[replace] chunk insert failed (${i}): ${chunkErr.message}`);
      else inserted += 1;
    }

    console.log(`[replace] done. file_id=${id} v${newVersion}, ${inserted}/${chunks.length} chunks stored`);
    res.json({ success: true, file: updated, chunk_count: inserted });
  } catch (err) {
    console.error('[replace] error:', err);
    res.status(500).json({ error: err.message || 'replace failed' });
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
  const { query, part, user_id, conversation_history, chat_model, include_chatroom } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query is required' });
  try {
    const partFilter = await resolvePartFilter({ user_id, part });

    let contextBlock;
    let sources = [];
    let evalChunks = [];
    let searchType = null;

    if (include_chatroom) {
      // Chatroom mode — skip document search entirely, use only chatroom chunks.
      const chatroomText = await getChatroomContext(query);
      contextBlock = chatroomText
        ? `--- Executive Chatroom History ---\n${chatroomText}`
        : '(no chatroom messages found)';
    } else {
      // Document mode — route to graph or vector search.
      let chunks;
      const route = await routeQuery(query, config.models.chat);
      searchType = route.search_type;
      console.log(`[chat] route=${route.search_type} (${route.reason})`);
      if (route.search_type === 'graph' && neo4jReady()) {
        chunks = await graphSearch({ entities: route.entities, partFilter });
        if (chunks.length === 0) {
          // Fallback to vector if graph returned nothing
          chunks = await retrieve({ query, partFilter });
        }
      } else {
        chunks = await retrieve({ query, partFilter });
      }
      contextBlock = chunks.length
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
      sources = chunks.map((c) => ({
        filename: c.filename,
        file_url: c.file_url,
        chunk_index: c.chunk_index,
        filetype: c.filetype,
      }));
      evalChunks = chunks.map((c) => ({ chunk_text: c.chunk_text, filename: c.filename }));
    }

    const history = Array.isArray(conversation_history) ? conversation_history : [];
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: `--- Context ---\n${contextBlock}\n\n--- Question ---\n${query}`,
      },
    ];

    let answer;
    if (chat_model === 'gemma') {
      answer = await generateChatGemma({ system: CHAT_SYSTEM, messages, maxTokens: 2048 });
    } else if (chat_model === 'glm') {
      answer = await generateChatGLM({ system: CHAT_SYSTEM, messages, maxTokens: 2048 });
    } else if (chat_model === 'kimi') {
      answer = await generateChatKimi({ system: CHAT_SYSTEM, messages, maxTokens: 2048 });
    } else {
      answer = await generateChat({ model: config.models.chat, system: CHAT_SYSTEM, messages, maxTokens: 4096 });
    }

    res.json({ answer, sources, eval_chunks: evalChunks, search_type: searchType });
  } catch (err) {
    console.error('[chat] error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------- RAG Evaluation ----------

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

async function judgeChunkRelevance(query, chunkText, model) {
  const raw = await generateText({
    model,
    system: 'You are a relevance judge. Given a query and a document chunk, return JSON {"relevant":true} if the chunk is useful for answering the query, or {"relevant":false} if it is not.',
    user: `Query: ${query}\n\nChunk: ${chunkText.slice(0, 1500)}`,
    jsonMode: true,
    maxTokens: 1024,
  });
  try { return JSON.parse(stripJsonFences(raw)).relevant === true; } catch { return false; }
}

async function decomposeAnswerIntoClaims(answer, model) {
  const raw = await generateText({
    model,
    system: 'Break the following answer into individual atomic factual claims — one per item. Return a JSON array of strings.',
    user: answer.slice(0, 3000),
    jsonMode: true,
    maxTokens: 4096,
  });
  try {
    const arr = JSON.parse(stripJsonFences(raw));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

async function judgeClaimsAgainstContext(claims, contextText, model) {
  const raw = await generateText({
    model,
    system: 'Given a context and a list of claims, return a JSON array of booleans — true if the claim can be found in or directly inferred from the context, false otherwise. Same order as input.',
    user: `Context:\n${contextText.slice(0, 4000)}\n\nClaims:\n${JSON.stringify(claims)}`,
    jsonMode: true,
    maxTokens: 2048,
  });
  try {
    const arr = JSON.parse(stripJsonFences(raw));
    return Array.isArray(arr) ? arr.map(Boolean) : claims.map(() => false);
  } catch { return claims.map(() => false); }
}

async function generateArtificialQuestions(answer, model) {
  const raw = await generateText({
    model,
    system: 'Given an answer, generate exactly 3 different questions that this answer would be a direct and complete response to. Return a JSON array of exactly 3 question strings. Example format: ["Question 1?", "Question 2?", "Question 3?"]',
    user: answer.slice(0, 3000),
    jsonMode: true,
    maxTokens: 1024,
  });
  try {
    const parsed = JSON.parse(stripJsonFences(raw));
    // Handle both bare array and wrapped object e.g. {"questions":[...]}
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.questions)
        ? parsed.questions
        : Object.values(parsed).find(Array.isArray) || [];
    return arr.slice(0, 3).map(String).filter(Boolean);
  } catch { return []; }
}

async function computeRagMetrics({ query, answer, chunks }) {
  const evalModel = config.models.chat;

  // 1. Context Precision@K
  // For each chunk at rank k: v_k = 1 if relevant, 0 if not.
  // Precision@k = relevant_so_far / k
  // Score = Σ(Precision@k × v_k) / total_relevant
  const relevanceFlags = await Promise.all(
    chunks.map((c) => judgeChunkRelevance(query, c.chunk_text, evalModel))
  );
  let relevantSoFar = 0;
  let sumPrecisionAtK = 0;
  const totalRelevant = relevanceFlags.filter(Boolean).length;
  for (let k = 0; k < relevanceFlags.length; k++) {
    const vk = relevanceFlags[k] ? 1 : 0;
    relevantSoFar += vk;
    sumPrecisionAtK += (relevantSoFar / (k + 1)) * vk;
  }
  const contextPrecision = totalRelevant > 0 ? sumPrecisionAtK / totalRelevant : 0;

  // 2. Faithfulness
  // Decompose answer into claims, check each against context.
  // Score = supported_claims / total_claims
  const claims = await decomposeAnswerIntoClaims(answer, evalModel);
  let faithfulness = 1;
  if (claims.length > 0) {
    const contextText = chunks.map((c) => c.chunk_text).join('\n\n');
    const supportFlags = await judgeClaimsAgainstContext(claims, contextText, evalModel);
    faithfulness = supportFlags.filter(Boolean).length / claims.length;
  }

  // 3. Response Relevance
  // Generate 3 artificial questions from the answer, embed them + embed the query,
  // then take the mean cosine similarity.
  let responseRelevance = 0;
  if (voyage) {
    try {
      const questions = await generateArtificialQuestions(answer, evalModel);
      if (questions.length > 0) {
        const [queryEmb, ...qEmbs] = await Promise.all([
          embedText(query, config.embeddingModel, 'query'),
          ...questions.map((q) => embedText(q, config.embeddingModel, 'query')),
        ]);
        const sims = qEmbs.map((e) => cosineSimilarity(queryEmb, e));
        responseRelevance = sims.reduce((a, b) => a + b, 0) / sims.length;
      }
    } catch (e) {
      console.warn('[eval] response relevance failed:', e.message);
    }
  }

  return {
    contextPrecision: Math.round(contextPrecision * 1000) / 1000,
    faithfulness: Math.round(faithfulness * 1000) / 1000,
    responseRelevance: Math.round(responseRelevance * 1000) / 1000,
  };
}

app.post('/api/chat/evaluate', async (req, res) => {
  const { query, answer, chunks } = req.body || {};
  if (!query || !answer || !Array.isArray(chunks) || chunks.length === 0) {
    return res.status(400).json({ error: 'query, answer, and chunks array are required' });
  }
  try {
    const metrics = await computeRagMetrics({ query, answer, chunks });

    if (supabase) {
      await supabase.from('rag_evaluations').insert({
        query,
        answer: answer.slice(0, 2000),
        context_precision: metrics.contextPrecision,
        faithfulness: metrics.faithfulness,
        response_relevance: metrics.responseRelevance,
      });

      const { data: summary } = await supabase
        .from('rag_eval_summary')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (summary) {
        const n = (summary.total_count || 0) + 1;
        await supabase.from('rag_eval_summary').upsert({
          id: 1,
          avg_context_precision: ((summary.avg_context_precision || 0) * (n - 1) + metrics.contextPrecision) / n,
          avg_faithfulness: ((summary.avg_faithfulness || 0) * (n - 1) + metrics.faithfulness) / n,
          avg_response_relevance: ((summary.avg_response_relevance || 0) * (n - 1) + metrics.responseRelevance) / n,
          total_count: n,
          updated_at: new Date().toISOString(),
        });
      }
    }

    res.json(metrics);
  } catch (err) {
    console.error('[chat/evaluate] error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat/eval-summary', async (req, res) => {
  const empty = { avg_context_precision: 0, avg_faithfulness: 0, avg_response_relevance: 0, total_count: 0 };
  if (!supabase) return res.json(empty);
  try {
    const { data, error } = await supabase.from('rag_eval_summary').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return res.json(empty);
    res.json(data);
  } catch (err) {
    res.json(empty);
  }
});

// ---------- Report Generator ----------
async function generateReport({ report_model, system, userMsg, maxTokens }) {
  if (report_model === 'gemma') return generateChatGemma({ system, messages: [{ role: 'user', content: userMsg }], maxTokens });
  if (report_model === 'glm')  return generateChatGLM({ system, messages: [{ role: 'user', content: userMsg }], maxTokens });
  if (report_model === 'kimi') return generateChatKimi({ system, messages: [{ role: 'user', content: userMsg }], maxTokens });
  return generateText({ model: config.models.summarisation, system, user: userMsg, maxTokens });
}

function outputFormatHint(output_format) {
  if (output_format === 'xlsx') {
    return '\n\n--- OUTPUT FORMAT ---\nTarget output: Excel (XLSX). Structure the report to maximise tabular data. Use HTML tables for all data, metrics, comparisons, and lists. Keep narrative text concise — prefer structured tables over long prose paragraphs.';
  }
  return '\n\n--- OUTPUT FORMAT ---\nTarget output: PDF. Use rich narrative text, detailed paragraphs, callout boxes, and full visual hierarchy as described in the formatting rules.';
}

const REPORT_SYSTEM = `You are a report-writing assistant that produces polished, professional HTML reports. You will be given:
1. A TEMPLATE — example structure showing how the user wants reports formatted
2. INPUT DATA — facts, notes, or context the user wants written up

Your job:
- Produce a complete, comprehensive report that follows the template's STRUCTURE, TONE, and FORMATTING (headings, sections, bullet points, table styles).
- Cover ALL input data thoroughly — do not summarise or truncate. Every data point, metric, finding, and detail in the input should appear in the report. Aim for depth and completeness, not brevity.
- Replace the template's example/placeholder content with the user's actual input data.
- Keep the same section ordering and formatting conventions as the template. Add sub-sections or additional rows/items as needed to accommodate all input data.
- Do NOT include <html>, <head>, <body>, or <style> tags — output only the inner content HTML.
- Do not invent facts not present in the input data — if a section can't be filled, write "<p><em>(not provided)</em></p>".

FORMATTING RULES — use inline styles for a polished, Word-ready look:

Headings:
- <h1> for report title: style="font-size:22pt; color:#1a1a2e; border-bottom:2px solid #3b82f6; padding-bottom:6pt; margin-top:20pt; margin-bottom:10pt; text-align:center;"
- <h2> for all sections: style="font-size:16pt; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:4pt; margin-top:16pt; margin-bottom:8pt;"
- <h3> for subsections: style="font-size:13pt; color:#334155; margin-top:12pt; margin-bottom:6pt;"

Table of Contents — if the report has a ToC, render it as a styled list (no colored backgrounds):
<nav style="border:1px solid #e2e8f0; border-radius:6px; padding:14pt 20pt; margin:16pt 0; background-color:#f8fafc;">
  <p style="font-size:13pt; font-weight:bold; color:#1e293b; margin:0 0 10pt 0; border-bottom:1px solid #e2e8f0; padding-bottom:6pt;">Table of Contents</p>
  <ol style="margin:0; padding-left:18pt; color:#334155; font-size:10pt; line-height:2;">
    <li style="margin-bottom:2pt;">Section title</li>
    ...
  </ol>
</nav>

Tables — always use full styling:
- <table>: style="width:100%; border-collapse:collapse; margin:10pt 0;"
- <th>: style="background-color:#1e293b; color:#ffffff; padding:8pt 10pt; text-align:left; font-size:10pt; border:1px solid #cbd5e1;"
- <td>: style="padding:7pt 10pt; font-size:10pt; border:1px solid #e2e8f0;"
- Alternate row shading: add style="background-color:#f8fafc;" on even <tr> rows in <tbody>.

Callout boxes — use for executive summaries, key takeaways, or important notes:
- <div style="background-color:#eff6ff; border-left:4px solid #3b82f6; padding:10pt 14pt; margin:10pt 0; border-radius:4px;">

IMPORTANT — No colored highlights on numbers or text:
- Do NOT use colored or highlighted spans for numbers, KPIs, or metrics. Write numbers inline as plain bold text: <strong>42</strong> items delivered.
- Do NOT use colored badge spans for statuses (no green/yellow/red/amber labels). Write statuses as plain text instead, e.g. "On Track", "At Risk", "Delayed".

Lists:
- <ul> and <ol>: style="margin:6pt 0; padding-left:20pt;"
- <li>: style="margin-bottom:4pt; line-height:1.5;"

Paragraphs: style="margin:6pt 0; line-height:1.6;"

Blockquotes: <blockquote style="border-left:3pt solid #94a3b8; padding:6pt 12pt; margin:8pt 0; color:#475569; background-color:#f8fafc;">

Return ONLY the report HTML. No preamble, no commentary, no markdown fences.`;

// Same as REPORT_SYSTEM but without the TEMPLATE section — for free-form generation
const REPORT_SYSTEM_FREE = `You are a report-writing assistant that produces polished, professional HTML reports.
You will be given INPUT DATA — facts, notes, or context the user wants written up.

Your job:
- Design a well-structured, comprehensive report based solely on the input data.
- Choose an appropriate report structure (title, introduction, sections, conclusion) that best presents the information.
- Cover ALL input data thoroughly — do not summarise or truncate. Every data point, metric, finding, and detail should appear in the report.
- Do NOT include <html>, <head>, <body>, or <style> tags — output only the inner content HTML.
- Do not invent facts not present in the input data.

FORMATTING RULES — use inline styles for a polished, print-ready look:

Headings:
- <h1> for report title: style="font-size:22pt; color:#1a1a2e; border-bottom:2px solid #3b82f6; padding-bottom:6pt; margin-top:20pt; margin-bottom:10pt; text-align:center;"
- <h2> for all sections: style="font-size:16pt; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:4pt; margin-top:16pt; margin-bottom:8pt;"
- <h3> for subsections: style="font-size:13pt; color:#334155; margin-top:12pt; margin-bottom:6pt;"

Table of Contents — if the report has a ToC, render it as a styled list:
<nav style="border:1px solid #e2e8f0; border-radius:6px; padding:14pt 20pt; margin:16pt 0; background-color:#f8fafc;">
  <p style="font-size:13pt; font-weight:bold; color:#1e293b; margin:0 0 10pt 0; border-bottom:1px solid #e2e8f0; padding-bottom:6pt;">Table of Contents</p>
  <ol style="margin:0; padding-left:18pt; color:#334155; font-size:10pt; line-height:2;">
    <li style="margin-bottom:2pt;">Section title</li>
    ...
  </ol>
</nav>

Tables — always use full styling:
- <table>: style="width:100%; border-collapse:collapse; margin:10pt 0;"
- <th>: style="background-color:#1e293b; color:#ffffff; padding:8pt 10pt; text-align:left; font-size:10pt; border:1px solid #cbd5e1;"
- <td>: style="padding:7pt 10pt; font-size:10pt; border:1px solid #e2e8f0;"
- Alternate row shading: add style="background-color:#f8fafc;" on even <tr> rows in <tbody>.

Callout boxes:
- <div style="background-color:#eff6ff; border-left:4px solid #3b82f6; padding:10pt 14pt; margin:10pt 0; border-radius:4px;">

IMPORTANT — No colored highlights on numbers or text:
- Do NOT use colored or highlighted spans for numbers, KPIs, or metrics. Write numbers as plain bold text: <strong>42</strong>.
- Do NOT use colored badge spans for statuses. Write statuses as plain text: "On Track", "At Risk", "Delayed".

Lists:
- <ul> and <ol>: style="margin:6pt 0; padding-left:20pt;"
- <li>: style="margin-bottom:4pt; line-height:1.5;"

Paragraphs: style="margin:6pt 0; line-height:1.6;"

Blockquotes: <blockquote style="border-left:3pt solid #94a3b8; padding:6pt 12pt; margin:8pt 0; color:#475569; background-color:#f8fafc;">

Return ONLY the report HTML. No preamble, no commentary, no markdown fences.`;

// ---------- Report Generator: free-form (no template) ----------
app.post('/api/report/generate', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  const { input_data, report_model, output_format, include_chatroom } = req.body || {};
  if (!input_data || !input_data.trim()) {
    return res.status(400).json({ error: 'input_data is required' });
  }
  try {
    let finalInput;
    if (include_chatroom) {
      const chatroomText = await getChatroomContext(input_data.slice(0, 500));
      finalInput = chatroomText
        ? `Report instruction: ${input_data}\n\n--- Executive Chatroom History (Source) ---\n${chatroomText}`
        : '(no chatroom messages found)';
    } else {
      finalInput = input_data;
    }
    const userMsg = `--- INPUT DATA ---\n${finalInput}${outputFormatHint(output_format)}`;
    const report = await generateReport({ report_model, system: REPORT_SYSTEM_FREE, userMsg, maxTokens: 16000 });
    res.json({ report, template_filename: 'report' });
  } catch (err) {
    console.error('[report-generate-free] error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/report/generate-from-files', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  const { instruction, file_ids, report_model, output_format, include_chatroom } = req.body || {};
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    return res.status(400).json({ error: 'file_ids array is required' });
  }
  try {
    let inputData;
    let usedFiles = [];

    if (include_chatroom) {
      // Chatroom mode — skip file fetching, use only chatroom context as source.
      const chatroomText = await getChatroomContext(instruction?.slice(0, 500) || null);
      const parts = [
        instruction ? `User instruction: ${instruction}` : null,
        chatroomText
          ? `--- Executive Chatroom History (Source) ---\n${chatroomText}`
          : '(no chatroom messages found)',
      ].filter(Boolean);
      inputData = parts.join('\n\n');
    } else {
      const { data: files, error: fErr } = await supabase
        .from('files').select('id, filename').in('id', file_ids);
      if (fErr) throw fErr;
      if (!files || files.length === 0) {
        return res.status(404).json({ error: 'no files found for the provided ids' });
      }
      usedFiles = files;

      const fileById = new Map(files.map((f) => [f.id, f]));
      const { data: chunks, error: cErr } = await supabase
        .from('chunks')
        .select('file_id, chunk_index, chunk_text')
        .in('file_id', file_ids)
        .order('chunk_index', { ascending: true });
      if (cErr) throw cErr;
      const byFile = new Map();
      for (const c of chunks || []) {
        if (!byFile.has(c.file_id)) byFile.set(c.file_id, []);
        byFile.get(c.file_id).push(c.chunk_text || '');
      }

      const PER_FILE_LIMIT = 60000;
      const sections = file_ids
        .map((fid) => {
          const f = fileById.get(fid);
          if (!f) return null;
          const text = (byFile.get(fid) || []).join('\n\n').slice(0, PER_FILE_LIMIT);
          if (!text.trim()) return null;
          return `### Source: ${f.filename}\n${text}`;
        })
        .filter(Boolean);

      if (sections.length === 0) {
        return res.status(422).json({ error: 'selected files have no extractable content' });
      }

      inputData = [
        instruction ? `User instruction: ${instruction}` : null,
        'Source documents:',
        sections.join('\n\n---\n\n'),
      ].filter(Boolean).join('\n\n');
    }

    const userMsg = `--- INPUT DATA ---\n${inputData}${outputFormatHint(output_format)}`;
    const report = await generateReport({ report_model, system: REPORT_SYSTEM_FREE, userMsg, maxTokens: 16000 });
    res.json({
      report,
      template_filename: 'report',
      used_files: usedFiles.map((f) => ({ id: f.id, filename: f.filename })),
    });
  } catch (err) {
    console.error('[report-generate-free-from-files] error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
  const { input_data, report_model, output_format, include_chatroom } = req.body || {};
  if (!input_data || !input_data.trim()) {
    return res.status(400).json({ error: 'input_data is required' });
  }
  try {
    const { data: tmpl, error: fetchErr } = await supabase
      .from('report_templates').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!tmpl) return res.status(404).json({ error: 'template not found' });

    let finalInput;
    if (include_chatroom) {
      const chatroomText = await getChatroomContext(input_data.slice(0, 500));
      finalInput = chatroomText
        ? `Report instruction: ${input_data}\n\n--- Executive Chatroom History (Source) ---\n${chatroomText}`
        : '(no chatroom messages found)';
    } else {
      finalInput = input_data;
    }
    const userMsg = `--- TEMPLATE (${tmpl.filename}) ---\n${tmpl.template_text}\n\n--- INPUT DATA ---\n${finalInput}${outputFormatHint(output_format)}`;
    const report = await generateReport({ report_model, system: REPORT_SYSTEM, userMsg, maxTokens: 16000 });
    res.json({ report, template_filename: tmpl.filename });
  } catch (err) {
    console.error('[report-generate] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Report Generator: NL file picker ----------
const FILE_MATCH_SYSTEM = `You are an assistant that selects relevant files from a document library based on a natural-language instruction.

You will be given:
1. The user's instruction describing the report they want.
2. A JSON list of available files, each with id, filename, uploaded_by, accessible_to (parts/teams), and uploaded_at.

Pick the files that are most relevant to fulfilling the instruction. Match on filename keywords, uploader, the parts/teams scope, and date hints in the instruction (e.g. "April", "Q1", "last sprint").

Return ONLY a JSON object with this exact shape — no markdown fences, no extra fields:
{"file_ids": ["<id>", "<id>", ...], "rationale": "<one short sentence explaining the match>"}

If nothing matches, return {"file_ids": [], "rationale": "no files matched the instruction"}.`;

app.post('/api/files/match', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { instruction, user_id } = req.body || {};
  if (!instruction || !instruction.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }
  try {
    // Reuse the same scoping rules as /api/files
    let q = supabase.from('files').select('id, filename, uploaded_by, accessible_to, uploaded_at').order('uploaded_at', { ascending: false });
    if (user_id) {
      const user = await loadUser(user_id);
      if (!user) return res.status(400).json({ error: 'unknown user' });
      const { scope, isAll } = userScope(user);
      if (!isAll) {
        if (!scope) return res.json({ matched: [], all: [], rationale: 'user has no scope' });
        q = q.contains('accessible_to', [scope]);
      }
    }
    const { data: files, error } = await q;
    if (error) throw error;
    if (!files || files.length === 0) {
      return res.json({ matched: [], all: [], rationale: 'no files in your scope' });
    }

    const payload = files.map((f) => ({
      id: f.id,
      filename: f.filename,
      uploaded_by: f.uploaded_by,
      accessible_to: f.accessible_to,
      uploaded_at: f.uploaded_at,
    }));
    const userMsg = `Instruction: ${instruction}\n\nAvailable files (JSON):\n${JSON.stringify(payload)}`;
    const raw = await generateText({
      model: config.models.scoring,
      system: FILE_MATCH_SYSTEM,
      user: userMsg,
      jsonMode: true,
      maxTokens: 1024,
    });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('[files/match] JSON parse failed. raw:\n', raw);
      throw new Error('matcher returned invalid JSON');
    }
    const matchedIds = new Set(Array.isArray(parsed.file_ids) ? parsed.file_ids : []);
    const matched = files.filter((f) => matchedIds.has(f.id));
    res.json({
      matched,
      all: files,
      rationale: parsed.rationale || '',
    });
  } catch (err) {
    console.error('[files/match] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Refine: grammar / spelling / paraphrase suggestions ──────────
const REFINE_SYSTEM = `You are a writing quality reviewer for professional documents.

Analyse the document text and identify genuine improvements in these categories:
- "spelling": a word that is clearly misspelled
- "grammar": a grammatically incorrect phrase or sentence
- "paraphrase": a sentence or short paragraph that could be written more clearly, concisely, or professionally

Return a JSON array (no wrapping object) of suggestions:
[{"type":"spelling"|"grammar"|"paraphrase","original":"exact original segment (max 220 chars)","suggestion":"corrected or improved version","explanation":"one short sentence"}]

Rules:
- Only flag real issues — do not nitpick style preferences
- For spelling/grammar the "original" must appear verbatim in the source text
- Return at most 10 suggestions; if the text is clean return []
- Return ONLY the JSON array, nothing else`;

app.post('/api/refine', async (req, res) => {
  const { file_id } = req.body || {};
  if (!file_id) return res.status(400).json({ error: 'file_id required' });
  try {
    const { data: chunks, error } = await supabase
      .from('chunks')
      .select('chunk_text, chunk_index')
      .eq('file_id', file_id)
      .order('chunk_index', { ascending: true });
    if (error) throw new Error(error.message);
    if (!chunks || chunks.length === 0) return res.json({ suggestions: [] });

    let text = chunks.map((c) => c.chunk_text).join('\n\n');
    if (text.length > 7000) text = text.slice(0, 7000);

    const raw = await generateText({
      model: config.models.scoring,
      system: REFINE_SYSTEM,
      user: `Analyse this document:\n\n${text}`,
      jsonMode: true,
      maxTokens: 3000,
    });

    const cleaned = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let suggestions = [];
    try {
      const parsed = JSON.parse(cleaned);
      suggestions = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.suggestions) ? parsed.suggestions : []);
    } catch {
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) { try { suggestions = JSON.parse(m[0]); } catch {} }
    }

    const VALID_TYPES = new Set(['spelling', 'grammar', 'paraphrase']);
    suggestions = suggestions
      .filter((s) => s && typeof s === 'object' && VALID_TYPES.has(s.type) && s.original && s.suggestion)
      .slice(0, 10);

    res.json({ suggestions, text });
  } catch (err) {
    console.error('[refine] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Refine: save edited text back to the original file ───────────
app.post('/api/refine/:id/save', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  const { edited_text, user_id } = req.body || {};
  if (!edited_text || !user_id) return res.status(400).json({ error: 'edited_text and user_id required' });

  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });

    const { data: existing, error: exErr } = await supabase.from('files').select('*').eq('id', id).maybeSingle();
    if (exErr) throw exErr;
    if (!existing) return res.status(404).json({ error: 'file not found' });
    if (existing.locked_by_id && existing.locked_by_id !== user_id && user.role !== 'MD') {
      return res.status(403).json({ error: `Locked by ${existing.locked_by_name || 'another user'}` });
    }

    const ext = extname(existing.filename).slice(1).toLowerCase();

    // Build file buffer — preserve docx format; everything else saves as plain text
    let buffer, saveExt, mimeType;
    if (ext === 'docx') {
      const { htmlToDocxBuffer: toDocx } = await import('./lib/htmlToDocx.js');
      const safeText = edited_text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = safeText.split('\n')
        .map((l) => l.trim() ? `<p>${l}</p>` : '<p>&nbsp;</p>').join('');
      buffer = await toDocx(html);
      saveExt = 'docx';
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else {
      buffer = Buffer.from(edited_text, 'utf-8');
      saveExt = ['txt', 'md'].includes(ext) ? ext : 'txt';
      mimeType = 'text/plain';
    }

    const baseName = existing.filename.replace(/\.[^.]+$/, '');
    const newFilename = `${baseName}.${saveExt}`;
    const storagePath = `${randomUUID()}-${newFilename.replace(/[^\w.\-]+/g, '_')}`;

    // 1. Upload new buffer to storage
    const { error: storageErr } = await supabase.storage.from('documents')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (storageErr) throw new Error('storage upload failed: ' + storageErr.message);
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(storagePath);

    // 2. Delete old storage object (best-effort)
    if (existing.file_url) {
      const oldPath = existing.file_url.split('/documents/')[1];
      if (oldPath) {
        const { error: rmErr } = await supabase.storage.from('documents').remove([oldPath]);
        if (rmErr) console.warn('[refine/save] old storage remove failed:', rmErr.message);
      }
    }

    // 3. Wipe old chunks
    const { error: delErr } = await supabase.from('chunks').delete().eq('file_id', id);
    if (delErr) throw new Error('failed to clear old chunks: ' + delErr.message);

    // 4. Update files row (bump version, clear lock)
    const newVersion = (existing.version || 1) + 1;
    const { data: updated, error: upErr } = await supabase
      .from('files')
      .update({
        filename: newFilename, filetype: saveExt, file_url: pub.publicUrl,
        version: newVersion, updated_by: user.name, updated_at: new Date().toISOString(),
        locked_by_id: null, locked_by_name: null, locked_at: null,
      })
      .eq('id', id).select().single();
    if (upErr) throw upErr;

    // 5. Re-chunk and re-index the edited text
    const rawChunks = chunkDocument({ text: edited_text, kind: 'txt' }, config.rag);
    const chunks = addContextPrefix(rawChunks);
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      let enriched = { summary: '', keywords: [], hypothetical_questions: [] };
      try { enriched = await enrichChunk(c.text, config.models.enrichment); }
      catch (err) { console.warn(`[refine/save] enrichment chunk ${i}: ${err.message}`); }
      const embeddingInput = buildEmbeddingInput(enriched) || c.text.slice(0, 2000);
      let embedding;
      try { embedding = await embedText(embeddingInput, config.embeddingModel, 'document'); }
      catch (err) { console.warn(`[refine/save] embed chunk ${i}: ${err.message}`); continue; }
      const { error: chunkErr } = await supabase.from('chunks').insert({
        file_id: id, chunk_text: c.text, chunk_summary: enriched.summary,
        keywords: enriched.keywords, hypothetical_questions: enriched.hypothetical_questions,
        embedding, chunk_index: i,
      });
      if (chunkErr) console.warn(`[refine/save] chunk insert ${i}: ${chunkErr.message}`);
      else inserted++;
    }

    console.log(`[refine/save] done. file_id=${id} v${newVersion}, ${inserted}/${chunks.length} chunks`);
    res.json({ success: true, file: updated, chunk_count: inserted });
  } catch (err) {
    console.error('[refine/save] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/report-templates/:id/generate-from-files', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  const { instruction, file_ids, report_model, output_format, include_chatroom } = req.body || {};
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    return res.status(400).json({ error: 'file_ids array is required' });
  }
  try {
    const { data: tmpl, error: tErr } = await supabase
      .from('report_templates').select('*').eq('id', id).maybeSingle();
    if (tErr) throw tErr;
    if (!tmpl) return res.status(404).json({ error: 'template not found' });

    let inputData;
    let usedFiles = [];

    if (include_chatroom) {
      // Chatroom mode — skip file fetching, use only chatroom context as source.
      const chatroomText = await getChatroomContext(instruction?.slice(0, 500) || null);
      const parts = [
        instruction ? `User instruction: ${instruction}` : null,
        chatroomText
          ? `--- Executive Chatroom History (Source) ---\n${chatroomText}`
          : '(no chatroom messages found)',
      ].filter(Boolean);
      inputData = parts.join('\n\n');
    } else {
      const { data: files, error: fErr } = await supabase
        .from('files').select('id, filename').in('id', file_ids);
      if (fErr) throw fErr;
      if (!files || files.length === 0) {
        return res.status(404).json({ error: 'no files found for the provided ids' });
      }
      usedFiles = files;

      const fileById = new Map(files.map((f) => [f.id, f]));
      const { data: chunks, error: cErr } = await supabase
        .from('chunks')
        .select('file_id, chunk_index, chunk_text')
        .in('file_id', file_ids)
        .order('chunk_index', { ascending: true });
      if (cErr) throw cErr;
      const byFile = new Map();
      for (const c of chunks || []) {
        if (!byFile.has(c.file_id)) byFile.set(c.file_id, []);
        byFile.get(c.file_id).push(c.chunk_text || '');
      }

      const PER_FILE_LIMIT = 60000;
      const sections = file_ids
        .map((fid) => {
          const f = fileById.get(fid);
          if (!f) return null;
          const text = (byFile.get(fid) || []).join('\n\n').slice(0, PER_FILE_LIMIT);
          if (!text.trim()) return null;
          return `### Source: ${f.filename}\n${text}`;
        })
        .filter(Boolean);

      if (sections.length === 0) {
        return res.status(422).json({ error: 'selected files have no extractable content' });
      }

      inputData = [
        instruction ? `User instruction: ${instruction}` : null,
        'Source documents:',
        sections.join('\n\n---\n\n'),
      ].filter(Boolean).join('\n\n');
    }

    const userMsg = `--- TEMPLATE (${tmpl.filename}) ---\n${tmpl.template_text}\n\n--- INPUT DATA ---\n${inputData}${outputFormatHint(output_format)}`;
    const report = await generateReport({ report_model, system: REPORT_SYSTEM, userMsg, maxTokens: 16000 });
    res.json({
      report,
      template_filename: tmpl.filename,
      used_files: usedFiles.map((f) => ({ id: f.id, filename: f.filename })),
    });
  } catch (err) {
    console.error('[report-generate-from-files] error:', err);
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

function momMarkdown(m) {
  const lines = [];
  lines.push(`# ${m.title || 'Meeting Minutes'}`);
  if (m.created_at) lines.push(`*${new Date(m.created_at).toLocaleDateString()}*`);
  if (Array.isArray(m.attendees) && m.attendees.length) {
    lines.push('', '**Attendees:** ' + m.attendees.join(', '));
  }
  if (m.summary) lines.push('', '## Summary', '', m.summary);
  if (Array.isArray(m.decisions) && m.decisions.length) {
    lines.push('', '## Decisions', '', ...m.decisions.map((d) => `- ${d}`));
  }
  if (Array.isArray(m.action_items) && m.action_items.length) {
    lines.push('', '## Action Items', '');
    for (const a of m.action_items) {
      lines.push(`- ${a.text}${a.owner ? ` — ${a.owner}` : ''}`);
    }
  }
  if (m.transcript) {
    lines.push('', '## Transcript', '', m.transcript);
  }
  return lines.join('\n');
}

async function loadMinute(id) {
  const { data, error } = await supabase.from('minutes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

function userCanSeeMinute(user, minute) {
  if (!user || !minute) return false;
  if (user.role === 'MD') return true;
  if (minute.created_by === user.id) return true;
  const scope = user.part || user.team;
  if (!scope) return false;
  return Array.isArray(minute.accessible_to) && minute.accessible_to.includes(scope);
}

app.get('/api/minutes', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const userId = req.query.user_id;
  try {
    let q = supabase.from('minutes').select('*').order('created_at', { ascending: false });
    if (userId) {
      const user = await loadUser(userId);
      if (!user) return res.status(400).json({ error: 'unknown user' });
      if (user.role !== 'MD') {
        const scope = user.part || user.team;
        if (!scope) return res.json({ minutes: [] });
        // Visibility: created by this user OR accessible_to contains user scope
        q = q.or(`created_by.eq.${user.id},accessible_to.cs.{${scope}}`);
      }
    }
    const { data, error } = await q;
    if (error) throw error;
    res.json({ minutes: data || [] });
  } catch (err) {
    console.error('[minutes] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/minutes', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const {
    title, summary, attendees, decisions, action_items, transcript,
    user_id, accessible_to,
  } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });

    // Default scope: uploader's part/team. MD can pick explicitly via accessible_to.
    const fallbackScope = user.part || user.team;
    const accessList = Array.isArray(accessible_to) && accessible_to.length
      ? accessible_to
      : (fallbackScope ? [fallbackScope] : []);

    const { data, error } = await supabase
      .from('minutes')
      .insert({
        title,
        summary: summary || '',
        attendees: attendees || [],
        decisions: decisions || [],
        action_items: action_items || [],
        transcript: transcript || '',
        created_by: user_id,
        accessible_to: accessList,
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ minute: data });
  } catch (err) {
    console.error('[minutes] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/minutes/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const userId = req.query.user_id || req.body?.user_id;
  try {
    const user = await loadUser(userId);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const minute = await loadMinute(id);
    if (!minute) return res.status(404).json({ error: 'not found' });
    if (user.role !== 'MD' && minute.created_by !== user.id) {
      return res.status(403).json({ error: 'only the creator or MD can delete' });
    }
    const { error } = await supabase.from('minutes').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[minutes] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Return MoM action items pre-shaped for the action-item review modal.
app.post('/api/minutes/:id/extract-action-items', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const userId = req.body?.user_id;
  try {
    const user = await loadUser(userId);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const minute = await loadMinute(id);
    if (!minute) return res.status(404).json({ error: 'not found' });
    if (!userCanSeeMinute(user, minute)) return res.status(403).json({ error: 'not permitted' });

    const items = (minute.action_items || []).map((a) => ({
      id: randomUUID(),
      text: a.text + (a.owner ? ` (mentioned: ${a.owner})` : ''),
      completed: false,
      assignees: [],
    }));
    res.json({
      source_type: 'mom',
      source_id: minute.id,
      filename: `MoM: ${minute.title}`,
      accessible_to: minute.accessible_to || [],
      items,
    });
  } catch (err) {
    console.error('[minutes] extract-action-items error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Render the MoM as markdown -> docx, store in Supabase, create a files row
// (and chunks) so it's discoverable in Library/Search.
app.post('/api/minutes/:id/save-to-hub', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { id } = req.params;
  const userId = req.body?.user_id;
  const accessibleToOverride = req.body?.accessible_to;
  try {
    const user = await loadUser(userId);
    if (!user) return res.status(400).json({ error: 'valid user_id required' });
    const minute = await loadMinute(id);
    if (!minute) return res.status(404).json({ error: 'not found' });
    if (!userCanSeeMinute(user, minute)) return res.status(403).json({ error: 'not permitted' });

    const md = momMarkdown(minute);
    const docx = await markdownToDocxBuffer(md);

    const safeTitle = (minute.title || 'meeting-minutes').replace(/[^\w.\-]+/g, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${safeTitle}-${stamp}.docx`;
    const storagePath = `${randomUUID()}-${filename}`;
    const { error: storageErr } = await supabase
      .storage.from('documents')
      .upload(storagePath, docx, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });
    if (storageErr) throw new Error('storage upload failed: ' + storageErr.message);
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(storagePath);

    const accessibleTo = Array.isArray(accessibleToOverride) && accessibleToOverride.length
      ? accessibleToOverride
      : (minute.accessible_to && minute.accessible_to.length ? minute.accessible_to : (user.part ? [user.part] : []));

    const { data: fileRow, error: fileErr } = await supabase
      .from('files')
      .insert({
        filename,
        filetype: 'docx',
        file_url: pub.publicUrl,
        uploaded_by: user.name,
        accessible_to: accessibleTo,
      })
      .select().single();
    if (fileErr) throw new Error('files insert failed: ' + fileErr.message);

    // Chunk the markdown text so the new file is searchable.
    const rawChunks = chunkDocument({ text: md, kind: 'md' }, config.rag);
    const chunks = addContextPrefix(rawChunks);
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      let enriched = { summary: '', keywords: [], hypothetical_questions: [] };
      try {
        enriched = await enrichChunk(c.text, config.models.enrichment);
      } catch (err) {
        console.warn(`[minutes/save-to-hub] enrichment failed for chunk ${i}: ${err.message}`);
      }
      const embeddingInput = buildEmbeddingInput(enriched) || c.text.slice(0, 2000);
      let embedding;
      try {
        embedding = await embedText(embeddingInput, config.embeddingModel, 'document');
      } catch (err) {
        console.warn(`[minutes/save-to-hub] embed failed for chunk ${i}: ${err.message}`);
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
      if (chunkErr) console.warn(`[minutes/save-to-hub] chunk insert failed (${i}): ${chunkErr.message}`);
      else inserted += 1;
    }

    res.status(201).json({ file: fileRow, chunk_count: inserted });
  } catch (err) {
    console.error('[minutes/save-to-hub] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Render HTML to .pdf ----------
import { htmlToPdfBuffer } from './lib/htmlToPdf.js';

app.post('/api/render-pdf', async (req, res) => {
  const { html, filename = 'report.pdf' } = req.body || {};
  if (!html || !html.trim()) {
    return res.status(400).json({ error: 'html is required' });
  }
  try {
    const out = await htmlToPdfBuffer(html);
    const safeName = String(filename).replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(out.length));
    res.end(out);
  } catch (err) {
    console.error('[render-pdf] error:', err);
    res.status(500).json({ error: err.message || 'pdf render failed' });
  }
});

// ---------- Tech Sensing — 1-page news report ----------
app.post('/api/tech-sensing/report', async (req, res) => {
  try {
    const cached = await readFeedCache('Tech Management');
    if (!cached || !cached.sources) {
      return res.status(404).json({ error: 'No Tech Sensing feed data found. Run the feed first.' });
    }

    // Flatten all articles from all sources
    const all = Object.entries(cached.sources).flatMap(([source, items]) =>
      (items || []).map((it) => ({ ...it, source }))
    );

    if (all.length === 0) {
      return res.status(404).json({ error: 'Feed has no articles. Run the feed first.' });
    }

    // Cap at 25 articles to keep prompt size predictable
    const capped = all.slice(0, 25);

    const articleList = capped
      .map((a, i) => {
        const desc = (a.description || '').trim();
        return desc
          ? `${i + 1}. [${a.source}] ${a.title}\n   Description: ${desc}`
          : `${i + 1}. [${a.source}] ${a.title}`;
      })
      .join('\n\n');

    const prompt = `You are an R&D intelligence analyst. Below are tech news articles fetched today, each with a title and sometimes a short description.

Select the 6 most important articles for an R&D technology organization — prioritise new technology, AI/ML advancements, emerging tools, and research breakthroughs.

For each selected article write:
- A concise headline (you may rephrase)
- A 2-sentence description: first sentence states what happened, second explains why it matters for R&D

Return ONLY a valid JSON array — no markdown, no explanation:
[{"title":"...","description":"...","url":"...","source":"..."},...]

Articles:
${articleList}`;

    const raw = await generateText({
      model: config.models.scoring,
      user: prompt,
      maxTokens: 8192,
    });

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let articles;
    try {
      articles = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'LLM returned invalid JSON', raw: raw.slice(0, 500) });
    }

    // Restore original URLs — LLM may hallucinate them
    const urlMap = Object.fromEntries(capped.map((a) => [a.title.toLowerCase().trim(), a.url]));
    articles = articles.map((a) => ({
      ...a,
      url: urlMap[a.title.toLowerCase().trim()] || a.url,
    }));

    if (!Array.isArray(articles) || articles.length === 0) {
      return res.status(500).json({ error: 'LLM returned no articles' });
    }

    const top6 = articles.slice(0, 6);
    const left = top6.slice(0, 3);
    const right = top6.slice(3, 6);

    const cardHtml = (a) => `
      <div class="news-card">
        <div class="news-source">${a.source || ''}</div>
        <a class="news-title" href="${a.url}" target="_blank">${a.title}</a>
        <p class="news-desc">${a.description}</p>
      </div>`;

    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `
      <div class="report-page">
        <div class="report-header">
          <h1>Tech Sensing — Daily Intelligence Brief</h1>
          <div class="report-date">${date}</div>
        </div>
        <div class="report-columns">
          <div class="report-col">${left.map(cardHtml).join('')}</div>
          <div class="report-divider"></div>
          <div class="report-col">${right.map(cardHtml).join('')}</div>
        </div>
        <div class="report-footer">Generated by Tech Sensing Feed · R&amp;D Intelligence</div>
      </div>

      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Calibri, 'Segoe UI', sans-serif; background: #fff; color: #1a1a2e; }
        .report-page { max-width: 1100px; margin: 0 auto; padding: 32px 28px; }
        .report-header { border-bottom: 3px solid #3b82f6; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
        .report-header h1 { font-size: 20pt; font-weight: 700; color: #1e293b; }
        .report-date { font-size: 10pt; color: #64748b; }
        .report-columns { display: flex; gap: 0; }
        .report-col { flex: 1; display: flex; flex-direction: column; gap: 20px; padding: 0 20px; }
        .report-col:first-child { padding-left: 0; }
        .report-col:last-child { padding-right: 0; }
        .report-divider { width: 1px; background: #e2e8f0; flex-shrink: 0; }
        .news-card { padding: 14px 0; border-bottom: 1px solid #f1f5f9; }
        .news-card:last-child { border-bottom: none; }
        .news-source { font-size: 8.5pt; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 5px; }
        .news-title { font-size: 11.5pt; font-weight: 700; color: #1e293b; text-decoration: none; line-height: 1.35; display: block; margin-bottom: 6px; }
        .news-title:hover { text-decoration: underline; }
        .news-desc { font-size: 10pt; color: #475569; line-height: 1.55; }
        .report-footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8.5pt; color: #94a3b8; text-align: center; }
      </style>`;

    res.json({ html });
  } catch (err) {
    console.error('[tech-sensing/report] error:', err);
    res.status(500).json({ error: err.message || 'report generation failed' });
  }
});

// ---------- Render HTML to .docx (kept for KnowledgeHubTab compatibility) ----------
import { htmlToDocxBuffer } from './lib/htmlToDocx.js';

app.post('/api/render-docx', async (req, res) => {
  const { html, filename = 'report.docx' } = req.body || {};
  if (!html || !html.trim()) {
    return res.status(400).json({ error: 'html is required' });
  }
  try {
    const out = await htmlToDocxBuffer(html);
    const safeName = String(filename).replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(out.length));
    res.end(out);
  } catch (err) {
    console.error('[render-docx] error:', err);
    res.status(500).json({ error: err.message || 'docx render failed' });
  }
});

// ---------- Render report content to .xlsx ----------
import XLSX from 'xlsx';

const XLSX_SYSTEM = `You are a data extraction assistant. Given report content or raw input data, extract all structured and quantitative information and format it as JSON for Excel export.

Output ONLY valid JSON — no markdown fences, no extra text — with this exact shape:
{
  "sheets": [
    {
      "name": "Sheet name (max 31 chars)",
      "rows": [
        ["Column A", "Column B", "Column C"],
        ["value", 42, "another value"],
        ...
      ]
    }
  ]
}

Rules:
- Create one sheet per major topic or category that has tabular data (metrics, action items, statuses, timelines, financials, etc.)
- The first row of every sheet must be a header row with column names
- If a value is numeric, output it as a number (not a string)
- Omit purely narrative content that cannot be meaningfully tabularised
- Sheet names must be unique and ≤ 31 characters
- If no tabular data can be extracted, return: {"sheets": [{"name": "Data", "rows": [["No tabular data found"]]}]}`;

app.post('/api/render-xlsx', async (req, res) => {
  const { html, report_model, filename = 'report.xlsx' } = req.body || {};
  if (!html || !html.trim()) {
    return res.status(400).json({ error: 'html is required' });
  }
  try {
    const userMsg = `Extract all structured/tabular data from the following report HTML:\n\n${html}`;
    const raw = await generateReport({ report_model, system: XLSX_SYSTEM, userMsg, maxTokens: 8000 });

    let parsed;
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      return res.status(422).json({ error: 'LLM did not return valid JSON for xlsx' });
    }

    const wb = XLSX.utils.book_new();
    for (const sheet of parsed.sheets || []) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows || []);
      XLSX.utils.book_append_sheet(wb, ws, String(sheet.name || 'Sheet').slice(0, 31));
    }
    if (wb.SheetNames.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([['No data']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = String(filename).replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (err) {
    console.error('[render-xlsx] error:', err);
    res.status(500).json({ error: err.message || 'xlsx render failed' });
  }
});

// ---------- Excel Compiler ----------
const XLSX_COMPILE_SYSTEM = `You are a spreadsheet compilation assistant. You will be given one or more Excel/CSV files as JSON (each with a filename and an array of sheets, each sheet having a name and a rows array-of-arrays). You will also receive a user instruction describing how to compile or transform the data.

Output ONLY valid JSON — no markdown fences, no extra text — with this exact shape:
{
  "sheets": [
    {
      "name": "Sheet name (≤31 chars)",
      "rows": [
        ["Column A", "Column B", "Column C"],
        [value1, value2, value3],
        ...
      ]
    }
  ]
}

Rules:
- Follow the instruction precisely to decide how to merge, filter, pivot, summarise, or restructure.
- When combining sheets of the same structure from multiple files, use a single unified header row and concatenate all data rows; add a "Source File" column as the first column so origin is traceable.
- Preserve data types: numbers stay as JSON numbers, text as strings. Empty cells as "".
- Sheet names must be unique and ≤ 31 characters.
- If the instruction is vague, default to: one output sheet per source sheet name, merging rows from all files that share that sheet name; otherwise one sheet per source file.
- Do not invent data that is not in the source files.`;

app.post('/api/xlsx/compile', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `not configured: missing ${ready.missing.join(', ')}` });

  const { file_ids, instruction, output_filename = 'compiled.xlsx', report_model } = req.body || {};
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    return res.status(400).json({ error: 'file_ids array is required' });
  }

  try {
    const { data: files, error: fErr } = await supabase
      .from('files')
      .select('id, filename, filetype, file_url')
      .in('id', file_ids);
    if (fErr) throw fErr;
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'no files found for the provided ids' });
    }

    const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv']);
    const excelFiles = files.filter((f) => {
      const ext = f.filename.split('.').pop().toLowerCase();
      return EXCEL_EXTS.has(ext);
    });
    if (excelFiles.length === 0) {
      return res.status(422).json({ error: 'none of the selected files are Excel or CSV files (.xlsx, .xls, .csv, .ods, …)' });
    }

    // Download and parse each file into rows-of-arrays
    const MAX_ROWS_PER_SHEET = 500;
    const MAX_SHEETS_PER_FILE = 10;
    const parsedFiles = [];
    const skipped = [];
    for (const file of excelFiles) {
      try {
        const resp = await fetch(file.file_url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
        const sheets = wb.SheetNames.slice(0, MAX_SHEETS_PER_FILE).map((name) => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
          const truncated = rows.length > MAX_ROWS_PER_SHEET;
          return { name, rows: rows.slice(0, MAX_ROWS_PER_SHEET), truncated };
        });
        parsedFiles.push({ filename: file.filename, sheets });
      } catch (e) {
        console.warn(`[xlsx-compile] skipping ${file.filename}: ${e.message}`);
        skipped.push(file.filename);
      }
    }

    if (parsedFiles.length === 0) {
      return res.status(422).json({ error: `could not read any Excel files${skipped.length ? ': ' + skipped.join(', ') : ''}` });
    }

    let outSheets;

    if (instruction && instruction.trim()) {
      // LLM-guided compilation
      const dataJson = JSON.stringify(parsedFiles);
      const userMsg = `Instruction: ${instruction}\n\nSource files:\n${dataJson}`;
      const raw = await generateReport({ report_model, system: XLSX_COMPILE_SYSTEM, userMsg, maxTokens: 16000 });
      let parsed;
      try {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/m, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        return res.status(422).json({ error: 'LLM did not return valid JSON for xlsx compilation' });
      }
      outSheets = parsed.sheets || [];
    } else {
      // Simple merge without LLM: one sheet per source sheet, all in one workbook
      outSheets = [];
      for (const { filename, sheets } of parsedFiles) {
        const base = filename.replace(/\.[^.]+$/, '');
        for (const sheet of sheets) {
          const label = sheets.length === 1
            ? base.slice(0, 31)
            : `${base} - ${sheet.name}`.slice(0, 31);
          outSheets.push({ name: label, rows: sheet.rows });
        }
      }
    }

    const outWb = XLSX.utils.book_new();
    // Deduplicate sheet names
    const usedNames = new Map();
    for (const sheet of outSheets) {
      let name = String(sheet.name || 'Sheet').slice(0, 31);
      if (usedNames.has(name)) {
        const count = usedNames.get(name) + 1;
        usedNames.set(name, count);
        name = `${name.slice(0, 28)} ${count}`;
      } else {
        usedNames.set(name, 1);
      }
      XLSX.utils.book_append_sheet(outWb, XLSX.utils.aoa_to_sheet(sheet.rows || []), name);
    }
    if (outWb.SheetNames.length === 0) {
      XLSX.utils.book_append_sheet(outWb, XLSX.utils.aoa_to_sheet([['No data']]), 'Sheet1');
    }

    const buf = XLSX.write(outWb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = String(output_filename).replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (err) {
    console.error('[xlsx-compile] error:', err);
    res.status(500).json({ error: err.message || 'xlsx compilation failed' });
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

// ---------- AI Quizzes: scores + leaderboard ----------
app.get('/api/quiz/leaderboard', async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('quiz_scores')
      .select('*')
      .order('score', { ascending: false })
      .order('attempted_at', { ascending: true });
    if (error) throw error;
    res.json({ scores: data || [] });
  } catch (err) {
    console.error('[quiz] leaderboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quiz/score', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { user_id, score, quiz_id = 'rag-basics', total = 5 } = req.body || {};
  if (!user_id || typeof score !== 'number') {
    return res.status(400).json({ error: 'user_id and numeric score are required' });
  }
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });
    const { data, error } = await supabase
      .from('quiz_scores')
      .upsert({
        user_id,
        user_name: user.name,
        quiz_id,
        score,
        total,
        attempted_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select().single();
    if (error) throw error;
    res.status(201).json({ score: data });
  } catch (err) {
    console.error('[quiz] score save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Gmail Integration ----------
function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3001'}/api/email/callback`
  );
}

async function getGmailTokens() {
  if (process.env.GMAIL_REFRESH_TOKEN) {
    return { refresh_token: process.env.GMAIL_REFRESH_TOKEN };
  }
  if (!supabase) return null;
  const { data } = await supabase.from('email_tokens').select('tokens').eq('key', 'gmail').maybeSingle();
  return data?.tokens || null;
}

async function saveGmailTokens(tokens) {
  if (!supabase) return;
  await supabase.from('email_tokens').upsert({ key: 'gmail', tokens, updated_at: new Date().toISOString() });
}

async function getAuthedGmail() {
  const tokens = await getGmailTokens();
  if (!tokens?.refresh_token) return null;
  const auth = makeOAuth2Client();
  auth.setCredentials(tokens);
  auth.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) saveGmailTokens({ ...tokens, ...newTokens });
  });
  return google.gmail({ version: 'v1', auth });
}

// GET /api/email/status
app.get('/api/email/status', async (_req, res) => {
  try {
    const tokens = await getGmailTokens();
    res.json({ connected: !!(tokens?.refresh_token) });
  } catch {
    res.json({ connected: false });
  }
});

// GET /api/email/auth
app.get('/api/email/auth', (_req, res) => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Gmail OAuth credentials not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET)' });
  }
  const auth = makeOAuth2Client();
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  });
  res.redirect(url);
});

// GET /api/email/callback
app.get('/api/email/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const auth = makeOAuth2Client();
    const { tokens } = await auth.getToken(code);
    await saveGmailTokens(tokens);
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    res.redirect(`${appUrl}/?gmail=connected`);
  } catch (err) {
    console.error('[gmail/callback]', err);
    res.status(500).send('OAuth callback failed: ' + err.message);
  }
});

// Helper: decode base64url
function b64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

// Helper: extract plain-text body and attachments from a message payload
function parsePayload(payload) {
  let body = '';
  const attachments = [];

  function walk(part) {
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body?.data) {
      body += b64url(part.body.data);
    } else if (mime === 'text/html' && !body && part.body?.data) {
      // Fallback: strip HTML tags
      body += b64url(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (part.body?.attachmentId && part.filename) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: mime,
        size: part.body.size || 0,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  }

  walk(payload);
  return { body: body.trim(), attachments };
}

// GET /api/email/messages?max=20
app.get('/api/email/messages', async (req, res) => {
  try {
    const gmail = await getAuthedGmail();
    if (!gmail) return res.status(401).json({ error: 'Gmail not connected' });

    const maxResults = Math.min(parseInt(req.query.max || '20', 10), 50);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults,
    });

    const msgs = listRes.data.messages || [];
    const emails = await Promise.all(
      msgs.map(async ({ id }) => {
        try {
          const msgRes = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          const msg = msgRes.data;
          const headers = {};
          for (const h of (msg.payload?.headers || [])) {
            headers[h.name.toLowerCase()] = h.value;
          }
          const { body, attachments } = parsePayload(msg.payload || {});
          return {
            id,
            subject: headers.subject || '(no subject)',
            from: headers.from || '',
            date: headers.date || '',
            snippet: msg.snippet || '',
            body: body.slice(0, 4000),
            attachments,
          };
        } catch (e) {
          console.warn('[gmail/messages] fetch error for', id, e.message);
          return null;
        }
      })
    );

    res.json({ emails: emails.filter(Boolean) });
  } catch (err) {
    console.error('[gmail/messages]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/summarize  { emails: [{from, subject, date, body}] }
app.post('/api/email/summarize', async (req, res) => {
  const { emails } = req.body || {};
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'emails array required' });
  }
  try {
    const emailBlock = emails.map((e, i) =>
      `[Email ${i + 1}]\nFrom: ${e.from}\nSubject: ${e.subject || '(no subject)'}\nDate: ${e.date || ''}\n\n${(e.body || e.snippet || '').slice(0, 1500)}`
    ).join('\n\n---\n\n');

    const summary = await generateText({
      model: config.models.enrichment,
      system: `You are a concise email assistant. Given a set of emails, write a short digest — one bullet point per email.
Each bullet must: mention the sender's name (drop the email address), state the core topic or ask, and flag any action/deadline if present.
Use plain text bullets starting with "•". Keep the whole digest under 120 words.`,
      user: `Summarise these ${emails.length} email${emails.length !== 1 ? 's' : ''}:\n\n${emailBlock}`,
      jsonMode: false,
      maxTokens: 2000,
    });

    res.json({ summary: (summary || '').trim() });
  } catch (err) {
    console.error('[email/summarize]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/extract-actions  { subject, body, user_id }
app.post('/api/email/extract-actions', async (req, res) => {
  const { subject, body: emailBody, user_id } = req.body || {};
  if (!emailBody?.trim()) return res.status(400).json({ error: 'body is required' });
  try {
    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });
    const text = `Subject: ${subject || ''}\n\n${emailBody}`;
    const items = await extractActionItems(text, config.models.enrichment);
    res.json({ items });
  } catch (err) {
    console.error('[email/extract-actions]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/upload-attachment  { messageId, attachmentId, filename, mimeType, user_id }
app.post('/api/email/upload-attachment', async (req, res) => {
  const ready = ragReady();
  if (!ready.ok) return res.status(503).json({ error: `RAG not configured: missing ${ready.missing.join(', ')}` });
  const { messageId, attachmentId, filename, mimeType, user_id } = req.body || {};
  if (!messageId || !attachmentId || !filename) return res.status(400).json({ error: 'messageId, attachmentId, filename required' });
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const gmail = await getAuthedGmail();
    if (!gmail) return res.status(401).json({ error: 'Gmail not connected' });

    const user = await loadUser(user_id);
    if (!user) return res.status(400).json({ error: 'unknown user' });

    const attRes = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    const data = attRes.data.data;
    const fileBuffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    const ext = extname(filename).slice(1).toLowerCase();
    const fileMime = mimeType || 'application/octet-stream';
    const filetype = `${fileMime} ${ext}`.trim();

    const accessibleTo = user.role === 'MD'
      ? [...(config.parts || []), 'Team 1', 'Team 2', 'Team 3']
      : [user.part || user.team].filter(Boolean);

    // Extract text
    const extracted = await extractText(fileBuffer, filetype);
    if (!extracted.text || extracted.text.trim().length < 30) {
      return res.status(422).json({ error: 'No extractable text found in attachment' });
    }

    // Chunk
    const rawChunks = chunkDocument(extracted, config.rag);
    const chunks = addContextPrefix(rawChunks);

    // Upload to Supabase Storage
    const storagePath = `${randomUUID()}-${filename.replace(/[^\w.\-]+/g, '_')}`;
    const { error: storageErr } = await supabase
      .storage.from('documents')
      .upload(storagePath, fileBuffer, { contentType: fileMime, upsert: false });
    if (storageErr) throw new Error('storage upload failed: ' + storageErr.message);
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(storagePath);

    // Insert files row
    const { data: fileRow, error: fileErr } = await supabase
      .from('files')
      .insert({ filename, filetype: ext || filetype, file_url: pub.publicUrl, uploaded_by: user.name, accessible_to: accessibleTo })
      .select().single();
    if (fileErr) throw new Error('files insert failed: ' + fileErr.message);

    // Embed + insert chunks
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      let enriched = { summary: '', keywords: [], hypothetical_questions: [] };
      try { enriched = await enrichChunk(c.text, config.models.enrichment); } catch {}
      const embeddingInput = buildEmbeddingInput(enriched) || c.text.slice(0, 2000);
      let embedding;
      try { embedding = await embedText(embeddingInput, config.embeddingModel, 'document'); } catch { continue; }
      const { error: chunkErr } = await supabase.from('chunks').insert({
        file_id: fileRow.id, chunk_text: c.text, chunk_summary: enriched.summary,
        keywords: enriched.keywords, hypothetical_questions: enriched.hypothetical_questions,
        embedding, chunk_index: i,
      });
      if (!chunkErr) inserted++;
    }

    res.json({ ok: true, file_id: fileRow.id, filename, chunk_count: inserted });
  } catch (err) {
    console.error('[email/upload-attachment]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Executive Chatroom ----------
function isExecUser(user) {
  return user && (user.role === 'MD' || user.role === 'PartHead');
}

function convId(a, b) {
  return [a, b].sort().join(':');
}

// Returns today's raw messages + semantically relevant historical chunks (via vector search).
async function getChatroomContext(query = null) {
  try {
    if (!supabase) return '';

    // Always include today's messages raw — they haven't been chunked yet.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: todayMsgs } = await supabase
      .from('chatroom_messages')
      .select('sender_name, content, created_at')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: true });

    const todayText = todayMsgs?.length
      ? '--- Today ---\n' + todayMsgs.map((m) => {
          const ts = new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
          return `[${ts}] ${m.sender_name}: ${m.content}`;
        }).join('\n')
      : '';

    // For historical data, do vector search on embedded chunks if a query is provided.
    let historicalText = '';
    if (query) {
      try {
        const qEmbedding = await embedText(query.slice(0, 2000), config.embeddingModel, 'query');
        const { data: chunks } = await supabase.rpc('match_chatroom_chunks', {
          query_embedding: qEmbedding,
          match_count: 5,
        });
        if (chunks?.length) {
          historicalText = '--- Relevant Past Discussions ---\n' +
            chunks.map((c) => `[Topic: ${c.topic_summary || 'Chat'}]\n${c.chunk_text}`).join('\n\n');
        }
      } catch {
        // Vector search unavailable (table may not exist yet) — silently skip.
      }
    }

    return [historicalText, todayText].filter(Boolean).join('\n\n') || '';
  } catch {
    return '';
  }
}

const CHATROOM_PARTITION_SYSTEM = `You are analyzing executive chat messages from a single day.
Group them into topically coherent chunks — messages discussing the same subject, project, or decision belong together.
Return a JSON array where each element has:
  "indices": array of message indices (0-based) belonging to this topic group
  "summary": one short sentence describing what this group of messages is about
Example: [{"indices":[0,1,2],"summary":"PRISM audit timeline"},{"indices":[3,4],"summary":"Data Management hiring"}]
Return only valid JSON.`;

// Processes one day's chatroom messages: partitions by topic (AI), embeds each partition, stores in chatroom_chunks.
async function processDayChatroom(dateStr) {
  if (!supabase) return;
  const dayStart = new Date(dateStr + 'T00:00:00.000Z');
  const dayEnd   = new Date(dateStr + 'T23:59:59.999Z');

  const { data: messages, error } = await supabase
    .from('chatroom_messages')
    .select('id, sender_name, content, created_at')
    .gte('created_at', dayStart.toISOString())
    .lte('created_at', dayEnd.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!messages || messages.length === 0) {
    console.log(`[chatroom-chunker] no messages for ${dateStr}, skipping`);
    return;
  }

  // Clear any previous chunks for this date so re-runs are idempotent.
  await supabase.from('chatroom_chunks').delete().eq('processed_date', dateStr);

  const formatted = messages.map((m, i) => {
    const ts = new Date(m.created_at).toLocaleTimeString('en-IN', { timeStyle: 'short' });
    return `[${i}] [${ts}] ${m.sender_name}: ${m.content}`;
  }).join('\n');

  let groups;
  try {
    const raw = await generateText({
      model: config.models.enrichment,
      system: CHATROOM_PARTITION_SYSTEM,
      user: `Messages from ${dateStr}:\n${formatted}`,
      jsonMode: true,
      maxTokens: 1500,
    });
    groups = JSON.parse(stripJsonFences(raw));
    if (!Array.isArray(groups)) throw new Error('not an array');
  } catch (err) {
    console.warn(`[chatroom-chunker] partition parse failed for ${dateStr}, using single chunk:`, err.message);
    groups = [{ indices: messages.map((_, i) => i), summary: `Executive discussion on ${dateStr}` }];
  }

  let inserted = 0;
  for (const group of groups) {
    const { indices, summary } = group || {};
    if (!Array.isArray(indices) || indices.length === 0) continue;

    const groupMessages = indices
      .filter((i) => Number.isInteger(i) && i >= 0 && i < messages.length)
      .map((i) => messages[i]);
    if (groupMessages.length === 0) continue;

    const chunkText = groupMessages.map((m) => {
      const ts = new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
      return `[${ts}] ${m.sender_name}: ${m.content}`;
    }).join('\n');

    try {
      const embedding = await embedText(chunkText, config.embeddingModel, 'document');
      await supabase.from('chatroom_chunks').insert({
        chunk_text: chunkText,
        topic_summary: String(summary || '').trim() || null,
        embedding,
        processed_date: dateStr,
      });
      inserted++;
    } catch (err) {
      console.warn(`[chatroom-chunker] embed/insert failed for group:`, err.message);
    }
  }

  console.log(`[chatroom-chunker] ${dateStr}: ${inserted} chunks stored from ${messages.length} messages`);
}

// Schedules processDayChatroom to run daily at 07:00 server local time for the previous day.
function scheduleChatroomChunker() {
  const now = new Date();
  const next = new Date();
  next.setHours(7, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  console.log(`[chatroom-chunker] next run scheduled at ${next.toLocaleString()}`);
  setTimeout(async () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().slice(0, 10);
    try { await processDayChatroom(dateStr); }
    catch (err) { console.error('[chatroom-chunker] error:', err.message); }
    scheduleChatroomChunker();
  }, ms);
}

scheduleChatroomChunker();

// GET /api/chatroom?user_id=X&with=Y  — fetch 1:1 conversation
app.get('/api/chatroom', async (req, res) => {
  const { user_id, with: withId } = req.query;
  if (!user_id || !withId) return res.status(400).json({ error: 'user_id and with are required' });
  try {
    const user = await loadUser(user_id);
    if (!user || !isExecUser(user)) return res.status(403).json({ error: 'Access restricted to MD and Part Heads' });
    const cid = convId(user_id, withId);
    const { data, error } = await supabase
      .from('chatroom_messages')
      .select('*')
      .eq('conversation_id', cid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ messages: data || [], conversation_id: cid });
  } catch (err) {
    console.error('[chatroom] get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chatroom  — send a 1:1 message
app.post('/api/chatroom', async (req, res) => {
  const { user_id, recipient_id, content } = req.body || {};
  if (!user_id || !recipient_id || !content?.trim()) {
    return res.status(400).json({ error: 'user_id, recipient_id and content are required' });
  }
  try {
    const user = await loadUser(user_id);
    if (!user || !isExecUser(user)) return res.status(403).json({ error: 'Access restricted to MD and Part Heads' });
    const cid = convId(user_id, recipient_id);
    const { data, error } = await supabase
      .from('chatroom_messages')
      .insert({ conversation_id: cid, sender_id: user_id, sender_name: user.name, content: content.trim() })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ message: data });
  } catch (err) {
    console.error('[chatroom] post error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chatroom/:id
app.delete('/api/chatroom/:id', async (req, res) => {
  const { user_id } = req.body || {};
  const { id } = req.params;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const user = await loadUser(user_id);
    if (!user || !isExecUser(user)) return res.status(403).json({ error: 'Access restricted to MD and Part Heads' });
    const { data: msg, error: fetchErr } = await supabase
      .from('chatroom_messages').select('sender_id').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender_id !== user_id && user.role !== 'MD') {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }
    const { error } = await supabase.from('chatroom_messages').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[chatroom] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/chatroom/process-chunks?date=YYYY-MM-DD  — manually trigger chunk processing for a date.
app.post('/api/admin/chatroom/process-chunks', async (req, res) => {
  const dateStr = req.query.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    await processDayChatroom(dateStr);
    res.json({ ok: true, date: dateStr });
  } catch (err) {
    console.error('[chatroom-chunker] manual trigger error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rag: ragReady() }));

if (process.env.NODE_ENV === 'production') {
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(join(__dirname, 'client', 'dist', 'index.html'));
  });
}

const httpServer = http.createServer(app);
httpServer.timeout = 360_000; // 6 min — headroom above the 5-min LLM budget
httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  initConstraints();
});
