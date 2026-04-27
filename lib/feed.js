// Tech Sensing Feed pipeline (Tab 1).
import FirecrawlApp from '@mendable/firecrawl-js';
import { generateText } from './llm.js';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

const SCORING_PROMPT = `You are a technology intelligence analyst. Score each news item 1-10 on relevance to technology and AI. High scores (8-10): new AI/ML model releases, AI infrastructure or hardware advances, enterprise AI adoption, India tech policy or ecosystem news, GCC and MNC R&D trends, semiconductor developments. Medium scores (5-7): general software engineering trends, open-source tooling, startup funding in AI. Low scores (1-4): consumer product launches, celebrity tech news, general business news unrelated to AI or R&D.

Return a JSON array of objects with shape {"id": <number>, "score": <integer 1-10>}. Every input id must appear exactly once.`;

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

async function scoreItems(items, model) {
  const payload = items.map((it, i) => ({
    id: i,
    title: it.title,
    snippet: (it.snippet || '').slice(0, 400),
  }));
  const raw = await generateText({
    model,
    system: SCORING_PROMPT,
    user: 'Score these items.\n\n' + JSON.stringify(payload),
    jsonMode: true,
    maxTokens: 2048,
  });
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (err) {
    console.error('[scoring] failed to parse JSON. raw:\n', raw);
    throw err;
  }
  const scores = new Array(items.length).fill(0);
  for (const entry of arr) {
    const idx = Number(entry.id);
    const sc = Number(entry.score);
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length) scores[idx] = sc;
  }
  return scores;
}

function shortlist(items, scores, threshold, max) {
  const annotated = items
    .map((it, i) => ({ ...it, score: scores[i] }))
    .filter((it) => it.score >= threshold);
  annotated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = Date.parse(a.date) || 0;
    const db = Date.parse(b.date) || 0;
    return db - da;
  });
  return annotated.slice(0, max);
}

async function summarise(body, model) {
  return generateText({
    model,
    system: SUMMARY_PROMPT,
    user: body.slice(0, 12000),
    maxTokens: 300,
  });
}

export async function runFeedPipeline(config) {
  const grouped = {};
  const errors = [];
  let total = 0;
  for (const src of config.sources) {
    console.log(`[${src.name}] scraping index…`);
    let raw;
    try {
      raw = await scrapeIndex(src.url);
    } catch (err) {
      console.warn(`[${src.name}] index scrape failed: ${err.message}`);
      errors.push({ source: src.name, stage: 'scrape', message: err.message });
      continue;
    }
    if (!raw.length) {
      console.warn(`[${src.name}] no items extracted`);
      continue;
    }

    let picked;
    try {
      const scores = await scoreItems(raw, config.models.scoring);
      picked = shortlist(raw, scores, config.scoringThreshold, config.maxItemsPerSource);
      if (!picked.length) {
        console.log(`[${src.name}] no items >= threshold; skipping`);
        continue;
      }
    } catch (err) {
      console.warn(`[${src.name}] scoring failed (${err.message}); fallback`);
      picked = raw.slice(0, config.maxItemsPerSource).map((it) => ({ ...it, score: null }));
    }

    const items = [];
    for (const it of picked) {
      let body = '';
      try {
        body = await fetchArticle(it.url);
      } catch (err) {
        console.warn(`[${src.name}] article fetch failed: ${err.message}`);
      }
      let summary = it.snippet || '';
      if (body) {
        try {
          summary = await summarise(body, config.models.summarisation);
        } catch (err) {
          console.warn(`[${src.name}] summary failed: ${err.message}`);
        }
      }
      items.push({
        title: it.title,
        url: it.url,
        source: src.name,
        date: it.date,
        summary,
        score: it.score ?? null,
      });
    }
    if (items.length) {
      grouped[src.name] = items;
      total += items.length;
    }
  }
  return { grouped, total, errors };
}
