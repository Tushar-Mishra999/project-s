// Tech Sensing Feed pipeline (Tab 1).
import Parser from 'rss-parser';
import { generateText } from './llm.js';

const rssParser = new Parser({ timeout: 30000 });

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapeIndexRss(rssUrl) {
  const feed = await rssParser.parseURL(rssUrl);
  return (feed.items || [])
    .slice(0, 40)
    .map((item) => {
      const html = item['content:encoded'] || item.content || '';
      const body = stripHtml(html);
      const snippet = stripHtml(item.contentSnippet || '') || body.slice(0, 400);
      return {
        title: (item.title || '').trim(),
        url: (item.link || '').trim(),
        snippet,
        date: (item.isoDate || item.pubDate || '').trim(),
        body,
      };
    })
    .filter((a) => a.title && a.url);
}

// Uses Gemini url_context to fetch a page and extract its article list.
async function scrapeIndexViaUrlContext(url, model) {
  const prompt = `Fetch this webpage and extract up to 40 article or blog post entries listed on it.

URL: ${url}

Return ONLY a JSON object with this exact shape (no markdown fences, no extra text):
{"articles": [{"title": "...", "url": "...", "snippet": "...", "date": "..."}]}

Rules:
- Only include actual articles/posts — skip nav links, ads, and footer links.
- Make all article URLs absolute (prepend the domain if relative).
- snippet: first sentence or visible description, otherwise empty string.
- date: ISO date string if visible on the page, otherwise empty string.`;

  const raw = await generateText({
    model,
    user: prompt,
    tools: [{ urlContext: {} }],
    jsonMode: true,
    maxTokens: 3000,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[url_context] index parse failed for ${url}:`, raw?.slice(0, 200));
    return [];
  }
  return (parsed.articles || [])
    .filter((a) => a?.title && a?.url)
    .slice(0, 40)
    .map((a) => ({
      title: String(a.title).trim(),
      url: String(a.url).trim(),
      snippet: String(a.snippet || '').trim(),
      date: String(a.date || '').trim(),
    }));
}

// Uses Gemini url_context to fetch an article URL and return a 2-3 sentence summary.
async function summariseViaUrlContext(url, model) {
  return generateText({
    model,
    user: `Fetch this article and summarise it in 2-3 sentences. Focus on: what the development is, who is involved, and why it matters for the AI/technology industry. Be factual and concise. Do not start with 'This article'.\n\nArticle URL: ${url}`,
    tools: [{ urlContext: {} }],
    maxTokens: 300,
  });
}

const SCORING_PROMPT = `You are a technology intelligence analyst. Score each news item 1-10 on relevance to technology and AI. High scores (8-10): new AI/ML model releases, AI infrastructure or hardware advances, enterprise AI adoption, India tech policy or ecosystem news, GCC and MNC R&D trends, semiconductor developments. Medium scores (5-7): general software engineering trends, open-source tooling, startup funding in AI. Low scores (1-4): consumer product launches, celebrity tech news, general business news unrelated to AI or R&D.

Return a JSON array of objects with shape {"id": <number>, "score": <integer 1-10>}. Every input id must appear exactly once.`;

const SUMMARY_PROMPT =
  "Summarise this article in 2-3 sentences. Focus on: what the development is, who is involved, and why it matters for the AI/technology industry. Be factual and concise. Do not start with 'This article'.";

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
    const useRss = !!src.rss;
    console.log(`[${src.name}] scraping index via ${useRss ? 'RSS' : 'Gemini url_context'}…`);
    let raw;
    try {
      raw = useRss
        ? await scrapeIndexRss(src.rss)
        : await scrapeIndexViaUrlContext(src.url, config.models.scoring);
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
      let summary = it.snippet || '';
      if (useRss && it.body) {
        // RSS feed included full body — summarise from text directly (no network call).
        try {
          summary = await summarise(it.body, config.models.summarisation);
        } catch (err) {
          console.warn(`[${src.name}] summary failed: ${err.message}`);
        }
      } else {
        // No body available (non-RSS or RSS without body) — use url_context to fetch+summarise.
        try {
          summary = await summariseViaUrlContext(it.url, config.models.summarisation);
        } catch (err) {
          console.warn(`[${src.name}] url_context summary failed: ${err.message}`);
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
