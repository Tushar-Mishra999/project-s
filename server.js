import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import FirecrawlApp from '@mendable/firecrawl-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

const PORT = process.env.PORT || 3001;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!FIRECRAWL_API_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing FIRECRAWL_API_KEY or ANTHROPIC_API_KEY in .env');
  process.exit(1);
}

const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SCORING_PROMPT = `You are a technology intelligence analyst. Score each news item 1-10 on relevance to technology and AI. High scores (8-10): new AI/ML model releases, AI infrastructure or hardware advances, enterprise AI adoption, India tech policy or ecosystem news, GCC and MNC R&D trends, semiconductor developments. Medium scores (5-7): general software engineering trends, open-source tooling, startup funding in AI. Low scores (1-4): consumer product launches, celebrity tech news, general business news unrelated to AI or R&D.

CRITICAL OUTPUT RULES:
- Return ONLY a raw JSON array. Nothing else.
- No markdown. No backticks. No \`\`\`json fences. No prose. No explanation.
- Format exactly: [{"id":0,"score":8},{"id":1,"score":3}]
- Every input id must appear exactly once in your output.`;

const SUMMARY_PROMPT =
  "Summarise this article in 2-3 sentences. Focus on: what the development is, who is involved, and why it matters for the AI/technology industry. Be factual and concise. Do not start with 'This article'.";

const INDEX_SCHEMA = {
  type: 'object',
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          snippet: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
  },
  required: ['articles'],
};

async function scrapeIndex(url) {
  const result = await firecrawl.scrapeUrl(url, {
    formats: ['json'],
    onlyMainContent: true,
    jsonOptions: {
      schema: INDEX_SCHEMA,
      prompt:
        'Extract up to 40 article entries listed on this page. For each: title, absolute URL, short snippet/description if visible, and publication date if visible.',
    },
  });
  if (!result.success) throw new Error(result.error || 'firecrawl scrape failed');
  const articles = result.json?.articles || result.data?.json?.articles || [];
  return articles
    .filter((a) => a?.title && a?.url)
    .slice(0, 40)
    .map((a) => ({
      title: String(a.title).trim(),
      url: String(a.url).trim(),
      snippet: String(a.snippet || '').trim(),
      date: String(a.date || '').trim(),
    }));
}

async function fetchArticle(url) {
  const result = await firecrawl.scrapeUrl(url, {
    formats: ['markdown'],
    onlyMainContent: true,
  });
  if (!result.success) throw new Error(result.error || 'firecrawl scrape failed');
  return (result.markdown || result.data?.markdown || '').trim();
}

function stripJsonFences(text) {
  let t = text.trim();
  // Strip ```json or ``` fences if present
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Extract first [...] block if surrounded by prose
  const m = t.match(/\[[\s\S]*\]/);
  return m ? m[0] : t;
}

async function scoreItems(items) {
  const payload = items.map((it, i) => ({
    id: i,
    title: it.title,
    snippet: (it.snippet || '').slice(0, 400),
  }));
  const resp = await anthropic.messages.create({
    model: config.models.scoring,
    max_tokens: 2048,
    system: SCORING_PROMPT,
    messages: [{ role: 'user', content: 'Score these items.\n\n' + JSON.stringify(payload) }],
  });
  const raw = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let arr;
  try {
    arr = JSON.parse(stripJsonFences(raw));
  } catch (err) {
    console.error('[scoring] failed to parse JSON. raw response:\n', raw);
    throw err;
  }
  const scores = new Array(items.length).fill(0);
  for (const entry of arr) {
    const idx = Number(entry.id);
    const sc = Number(entry.score);
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length) {
      scores[idx] = sc;
    }
  }
  return scores;
}

function shortlist(items, scores) {
  const annotated = items
    .map((it, i) => ({ ...it, score: scores[i] }))
    .filter((it) => it.score >= config.scoringThreshold);
  annotated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = Date.parse(a.date) || 0;
    const db = Date.parse(b.date) || 0;
    return db - da;
  });
  return annotated.slice(0, config.maxItemsPerSource);
}

async function summarise(body) {
  const resp = await anthropic.messages.create({
    model: config.models.summarisation,
    max_tokens: 300,
    system: SUMMARY_PROMPT,
    messages: [{ role: 'user', content: body.slice(0, 12000) }],
  });
  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function processSource(src) {
  console.log(`[${src.name}] scraping index…`);
  let raw;
  try {
    raw = await scrapeIndex(src.url);
  } catch (err) {
    console.warn(`[${src.name}] index scrape failed: ${err.message}`);
    return [];
  }
  if (!raw.length) {
    console.warn(`[${src.name}] no items extracted`);
    return [];
  }

  console.log(`[${src.name}] ${raw.length} raw items, scoring…`);
  let picked;
  try {
    const scores = await scoreItems(raw);
    picked = shortlist(raw, scores);
    if (!picked.length) {
      console.log(`[${src.name}] no items >= threshold; skipping`);
      return [];
    }
  } catch (err) {
    console.warn(`[${src.name}] scoring failed (${err.message}); falling back to top-N by order`);
    picked = raw.slice(0, config.maxItemsPerSource).map((it) => ({ ...it, score: null }));
  }

  console.log(`[${src.name}] ${picked.length} shortlisted; fetching articles…`);
  const out = [];
  for (const it of picked) {
    let body = '';
    try {
      body = await fetchArticle(it.url);
    } catch (err) {
      console.warn(`[${src.name}] article fetch failed for ${it.url}: ${err.message}`);
    }
    let summary = it.snippet || '';
    if (body) {
      try {
        summary = await summarise(body);
      } catch (err) {
        console.warn(`[${src.name}] summary failed for ${it.url}: ${err.message}`);
      }
    }
    out.push({
      title: it.title,
      url: it.url,
      source: src.name,
      date: it.date,
      summary,
      score: it.score ?? null,
    });
  }
  return out;
}

const app = express();
app.use(cors());
app.use(express.json());

// In production, serve the built React app from client/dist
if (process.env.NODE_ENV === 'production') {
  const clientDist = join(__dirname, 'client', 'dist');
  app.use(express.static(clientDist));
}

app.get('/api/feed', async (_req, res) => {
  const started = Date.now();
  console.log(`\n=== /api/feed run at ${new Date().toISOString()} ===`);
  try {
    const grouped = {};
    let total = 0;
    for (const src of config.sources) {
      const items = await processSource(src);
      if (items.length) {
        grouped[src.name] = items;
        total += items.length;
      }
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s. ${total} items across ${Object.keys(grouped).length} sources.`);
    res.json({
      generatedAt: new Date().toISOString(),
      count: total,
      sources: grouped,
    });
  } catch (err) {
    console.error('pipeline error:', err);
    res.status(500).json({ error: err.message || 'pipeline failed' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// SPA fallback in production — serve index.html for non-API routes
if (process.env.NODE_ENV === 'production') {
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(join(__dirname, 'client', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
