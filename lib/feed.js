// Tech Sensing Feed pipeline.
// Priority: RSS feed (if available) → Firecrawl + Gemini (fallback for all others).
import Parser from 'rss-parser';
import FirecrawlApp from '@mendable/firecrawl-js';
import { generateText } from './llm.js';

const rssParser = new Parser({ timeout: 30000 });

let _firecrawl = null;
function firecrawl() {
  if (_firecrawl) return _firecrawl;
  if (!process.env.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY not set');
  _firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  return _firecrawl;
}

async function fetchViaFirecrawl(url) {
  const fc = firecrawl();
  const resp = await fc.scrapeUrl(url, { formats: ['markdown'] });
  if (resp && resp.success === false) throw new Error(`firecrawl failed: ${resp.error || 'unknown'}`);
  const md = resp?.data?.markdown ?? resp?.markdown ?? '';
  if (!md) throw new Error('firecrawl returned no markdown');
  return md;
}

// Parse an RSS feed and return article titles + URLs directly — no scraping or LLM needed.
async function scrapeIndexRss(rssUrl, limit) {
  console.log(`[rss] fetching: ${rssUrl}`);
  const feed = await rssParser.parseURL(rssUrl);
  const articles = (feed.items || [])
    .slice(0, limit)
    .map((item) => ({ title: (item.title || '').trim(), url: (item.link || '').trim() }))
    .filter((a) => a.title && a.url);
  console.log(`[rss] got ${articles.length} article(s):`, articles.map((a) => a.title).join(' | '));
  return articles;
}

// Scrape a URL with Firecrawl, then ask Gemini to extract article headlines + URLs.
async function scrapeIndex(url, model, limit) {
  console.log(`\n[firecrawl] scraping: ${url}`);
  const md = await fetchViaFirecrawl(url);
  console.log(`[firecrawl] markdown length: ${md.length} chars`);
  console.log(`[firecrawl] markdown preview:\n---\n${md.slice(0, 800)}\n---`);

  const prompt = `The following is the markdown content of a news or blog listing page. Extract the ${limit} most recent article headlines and their URLs.

Source URL: ${url}

Markdown content:
${md.slice(0, 30000)}

Return ONLY a JSON object in this exact shape (no markdown fences, no extra text):
{"articles": [{"title": "...", "url": "..."}]}

Rules:
- Only include actual article/post entries — skip navigation links, ads, category headers, footers, and sidebar links.
- Make all URLs absolute (prepend the site origin if the path is relative).
- Return at most ${limit} articles, newest first.`;

  const raw = await generateText({ model, user: prompt, jsonMode: true, maxTokens: 800 });
  console.log(`[gemini] raw extraction for ${url}:\n${raw}\n`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[gemini] JSON parse failed for ${url}. Raw response:`, raw?.slice(0, 400));
    return [];
  }

  const articles = (parsed.articles || [])
    .filter((a) => a?.title && a?.url)
    .slice(0, limit)
    .map((a) => {
      let articleUrl = String(a.url).trim();
      try { articleUrl = new URL(articleUrl, url).href; } catch { /* keep as-is */ }
      return { title: String(a.title).trim(), url: articleUrl };
    });

  console.log(`[gemini] extracted ${articles.length} article(s):`, articles.map((a) => a.title).join(' | '));
  return articles;
}

const WORKLET_RELEVANCE_PROMPT = `You are evaluating news articles for "worklet" suitability on a research-and-development platform.

A WORKLET is a focused 3-5 day research/engineering task that an engineer or strong intern can pick up. Worklets typically involve hands-on building, fine-tuning, benchmarking, or prototyping around an emerging technology, model, framework, or technique. Examples: "fine-tune a small model on a domain dataset", "benchmark a new vector DB", "implement a paper's algorithm and reproduce its results", "prototype an inference optimisation".

For each input item, return a relevance label:
- "High": describes a concrete new model, technique, library, dataset, paper, or capability that an engineer could directly turn into a hands-on prototype, benchmark, or reproduction. Specific and technical.
- "Medium": tech-relevant but more strategic, partial, or industry-news flavoured — could inspire a worklet with extra framing.
- "Low": general business/policy/consumer news, opinion pieces, funding announcements, or anything without enough technical substance to build on.

Return ONLY a JSON array with shape:
[{"id": <number>, "relevance": "High" | "Medium" | "Low"}]
Every input id must appear exactly once.`;

async function scoreWorkletRelevance(items, model) {
  const payload = items.map((it, i) => ({ id: i, title: it.title }));
  const raw = await generateText({
    model,
    system: WORKLET_RELEVANCE_PROMPT,
    user: 'Classify these items.\n\n' + JSON.stringify(payload),
    jsonMode: true,
    maxTokens: 1024,
  });
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (err) {
    console.error('[worklet-relevance] failed to parse JSON. raw:\n', raw);
    throw err;
  }
  const out = new Array(items.length).fill(null);
  for (const entry of arr) {
    const idx = Number(entry.id);
    const label = entry.relevance;
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length
        && ['High', 'Medium', 'Low'].includes(label)) {
      out[idx] = label;
    }
  }
  return out;
}

export async function runFeedPipeline(config) {
  const grouped = {};
  const errors = [];
  let total = 0;

  for (const src of config.sources) {
    const limit = config.maxItemsPerSource;
    console.log(`\n[pipeline] === ${src.name} (limit: ${limit}) ===`);

    const method = src.rss ? 'RSS' : 'Firecrawl + Gemini';
    console.log(`[pipeline] method: ${method}`);

    let articles;
    try {
      articles = src.rss
        ? await scrapeIndexRss(src.rss, limit)
        : await scrapeIndex(src.url, config.models.scoring, limit);
    } catch (err) {
      console.error(`[pipeline] ${src.name} scrape failed: ${err.message}`, err.stack || '');
      errors.push({ source: src.name, stage: 'scrape', message: err.message });
      continue;
    }

    if (!articles.length) {
      console.warn(`[pipeline] ${src.name} — no articles extracted, skipping`);
      continue;
    }

    const items = articles.map((a) => ({
      title: a.title,
      url: a.url,
      source: src.name,
      date: '',
      summary: '',
      score: null,
      workletRelevance: null,
    }));

    const isPrismSource = Array.isArray(src.parts) && src.parts.includes('PRISM');
    if (isPrismSource && items.length) {
      try {
        const labels = await scoreWorkletRelevance(items, config.models.scoring);
        items.forEach((it, i) => { it.workletRelevance = labels[i]; });
      } catch (err) {
        console.warn(`[pipeline] ${src.name} worklet relevance failed: ${err.message}`);
      }
    }

    grouped[src.name] = items;
    total += items.length;
  }

  return { grouped, total, errors };
}
