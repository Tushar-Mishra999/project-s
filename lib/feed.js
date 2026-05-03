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

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`got status: ${resp.status} ${resp.statusText}`);
  return resp.text();
}

// Fetch the page directly and let Gemini extract the article list from the HTML.
async function scrapeIndexViaUrlContext(url, model) {
  const html = await fetchHtml(url);
  const text = stripHtml(html).slice(0, 30000);

  const prompt = `The following is the visible text of an index/listing webpage. Extract up to 40 article or blog post entries.

URL: ${url}

Page text:
${text}

Return ONLY a JSON object with this exact shape (no markdown fences, no extra text):
{"articles": [{"title": "...", "url": "...", "snippet": "...", "date": "..."}]}

Rules:
- Only include actual articles/posts — skip nav links, ads, and footer links.
- Make all article URLs absolute (prepend the page's origin if relative).
- snippet: first sentence or visible description, otherwise empty string.
- date: ISO date string if visible on the page, otherwise empty string.`;

  const raw = await generateText({
    model,
    user: prompt,
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

// Fetch an article URL directly and ask Gemini to summarise the page text.
async function summariseViaUrlContext(url, model) {
  let text;
  try {
    const html = await fetchHtml(url);
    text = stripHtml(html).slice(0, 12000);
  } catch (err) {
    throw new Error(`fetch failed: ${err.message}`);
  }
  return generateText({
    model,
    user: `Summarise this article in MINIMUM 100 words (target 120-160). Cover: what the development is, who is involved, the key technical or business details, and why it matters for the AI/technology industry. Be factual, dense, and concrete. Do not start with 'This article'. Output a single paragraph — no bullets, no headings.\n\nURL: ${url}\n\nArticle text:\n${text}`,
    maxTokens: 600,
  });
}

const SCORING_PROMPT = `You are a technology intelligence analyst. Score each news item 1-10 on relevance to technology and AI. High scores (8-10): new AI/ML model releases, AI infrastructure or hardware advances, enterprise AI adoption, India tech policy or ecosystem news, GCC and MNC R&D trends, semiconductor developments. Medium scores (5-7): general software engineering trends, open-source tooling, startup funding in AI. Low scores (1-4): consumer product launches, celebrity tech news, general business news unrelated to AI or R&D.

Return a JSON array of objects with shape {"id": <number>, "score": <integer 1-10>}. Every input id must appear exactly once.`;

const SUMMARY_PROMPT =
  "Summarise this article in MINIMUM 100 words (target 120-160). Cover: what the development is, who is involved, the key technical or business details, and why it matters for the AI/technology industry. Be factual, dense, and concrete. Do not start with 'This article'. Output a single paragraph — no bullets, no headings.";

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
    maxTokens: 600,
  });
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
  const payload = items.map((it, i) => ({
    id: i,
    title: it.title,
    summary: (it.summary || it.snippet || '').slice(0, 500),
  }));
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
    const useRss = !!src.rss;
    console.log(`[${src.name}] scraping index via ${useRss ? 'RSS' : 'fetch + Gemini'}…`);
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
        workletRelevance: null,
      });
    }

    // Worklet-relevance classification — runs for any source tagged PRISM,
    // since that's where the High/Medium/Low badge is displayed.
    const isPrismSource = Array.isArray(src.parts) && src.parts.includes('PRISM');
    if (isPrismSource && items.length) {
      try {
        const labels = await scoreWorkletRelevance(items, config.models.scoring);
        items.forEach((it, i) => { it.workletRelevance = labels[i]; });
      } catch (err) {
        console.warn(`[${src.name}] worklet relevance scoring failed: ${err.message}`);
      }
    }

    if (items.length) {
      grouped[src.name] = items;
      total += items.length;
    }
  }
  return { grouped, total, errors };
}
