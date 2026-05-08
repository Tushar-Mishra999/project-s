// Tech Sensing Feed pipeline — all sources use RSS feeds.
import Parser from 'rss-parser';
import { generateText } from './llm.js';

const rssParser = new Parser({ timeout: 30000 });

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

const RELEVANCE_PROMPT = `You are an editorial assistant scoring news article headlines for a professional intelligence feed.

For each headline, assign a relevance label based on how significant, actionable, or informative the article is likely to be for professionals tracking this domain:
- "High": breaking news, major announcements, concrete technical developments, significant research findings, or anything with clear immediate impact.
- "Medium": useful context, trend pieces, product updates, or industry moves that are worth knowing but not urgent.
- "Low": opinion fluff, recycled news, vague roundups, clickbait, or anything with low informational value.

Return ONLY a JSON array with shape:
[{"id": <number>, "relevance": "High" | "Medium" | "Low"}]
Every input id must appear exactly once.`;

async function scoreRelevance(items, model) {
  const payload = items.map((it, i) => ({ id: i, title: it.title }));
  const userMsg = 'Score these headlines.\n\n' + JSON.stringify(payload);

  let raw;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = await generateText({
        model,
        system: RELEVANCE_PROMPT,
        user: userMsg,
        jsonMode: true,
        maxTokens: 512,
      });
      if (raw && raw.trim()) break;
      console.warn(`[relevance] attempt ${attempt} returned empty response, retrying…`);
    } catch (err) {
      console.warn(`[relevance] attempt ${attempt} threw: ${err.message}`);
      if (attempt === 3) throw err;
    }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }

  if (!raw || !raw.trim()) {
    console.error('[relevance] all attempts returned empty — skipping scoring');
    return new Array(items.length).fill(null);
  }

  console.log(`[relevance] raw (${raw.length} chars):`, raw.slice(0, 400));

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let arr;
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const firstArray = Object.values(parsed).find(Array.isArray);
      arr = firstArray || [];
      if (!firstArray) console.warn('[relevance] unexpected JSON shape:', JSON.stringify(parsed).slice(0, 200));
    } else {
      arr = [];
    }
  } catch (err) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      try { arr = JSON.parse(m[0]); } catch { arr = []; }
    } else {
      console.error('[relevance] JSON.parse failed. raw:\n', raw);
      throw err;
    }
  }

  const VALID = new Set(['high', 'medium', 'low']);
  const out = new Array(items.length).fill(null);
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const idx = Number(entry.id);
    const rawLabel = String(
      entry.relevance ?? entry.relevance_level ?? entry.label ?? entry.score ?? entry.classification ?? ''
    ).trim();
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length && VALID.has(rawLabel.toLowerCase())) {
      out[idx] = label;
    }
  }

  const nullCount = out.filter(v => v === null).length;
  if (nullCount > 0) {
    console.warn(`[relevance] ${nullCount}/${items.length} items left unscored after parse`);
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

    if (!src.rss) {
      console.warn(`[pipeline] ${src.name} — no RSS feed configured, skipping`);
      continue;
    }

    let articles;
    try {
      articles = await scrapeIndexRss(src.rss, limit);
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
    if (isPrismSource) {
      console.log(`[pipeline] scoring worklet relevance for ${src.name} (${items.length} items)…`);
      try {
        const labels = await scoreRelevance(items, config.models.scoring);
        items.forEach((it, i) => { it.workletRelevance = labels[i]; });
        const scored = labels.filter(Boolean).length;
        console.log(`[pipeline] ${src.name} scored ${scored}/${items.length}: ${labels.join(', ')}`);
      } catch (err) {
        console.warn(`[pipeline] ${src.name} worklet relevance scoring failed: ${err.message}`);
      }
    }

    grouped[src.name] = items;
    total += items.length;
  }

  return { grouped, total, errors };
}
