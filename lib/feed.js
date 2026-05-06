// Tech Sensing Feed pipeline (Tab 1).
import Parser from 'rss-parser';
import FirecrawlApp from '@mendable/firecrawl-js';
import { generateText } from './llm.js';

const rssParser = new Parser({ timeout: 30000 });

let _firecrawl = null;
function firecrawl() {
  if (_firecrawl) return _firecrawl;
  if (!process.env.FIRECRAWL_API_KEY) return null;
  _firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  return _firecrawl;
}

// Returns the page text via Firecrawl (markdown). Throws if Firecrawl
// isn't configured or the call fails.
async function fetchViaFirecrawl(url) {
  const fc = firecrawl();
  if (!fc) throw new Error('FIRECRAWL_API_KEY not set; firecrawl scraper unavailable');
  const resp = await fc.scrapeUrl(url, { formats: ['markdown'] });
  // SDK shape varies between versions: { success, data: { markdown } } or
  // { markdown } directly.
  if (resp && resp.success === false) {
    throw new Error(`firecrawl failed: ${resp.error || 'unknown'}`);
  }
  const md = resp?.data?.markdown ?? resp?.markdown ?? '';
  if (!md) throw new Error('firecrawl returned no markdown');
  return md;
}

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
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`got status: ${resp.status} ${resp.statusText}`);
  return resp.text();
}

// Fetch the page directly and let Gemini extract the article list from the HTML.
async function scrapeIndexViaUrlContext(url, model, { useFirecrawl = false } = {}) {
  let text;
  if (useFirecrawl) {
    text = (await fetchViaFirecrawl(url)).slice(0, 30000);
  } else {
    const html = await fetchHtml(url);
    text = stripHtml(html).slice(0, 30000);
  }

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
    .map((a) => {
      let articleUrl = String(a.url).trim();
      try {
        articleUrl = new URL(articleUrl, url).href;
      } catch {
        // keep as-is if unparseable
      }
      return {
        title: String(a.title).trim(),
        url: articleUrl,
        snippet: String(a.snippet || '').trim(),
        date: String(a.date || '').trim(),
      };
    });
}

// Scrape the index page via Crawl4AI and ask Gemini to extract the 3 latest articles (title + url only).
async function scrapeIndexViaCrawl4AI(url, model) {
  const baseUrl = (process.env.CRAWL4AI_BASE_URL || 'http://localhost:11235').replace(/\/$/, '');
  const endpoint = `${baseUrl}/crawl_sync`;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CRAWL4AI_API_TOKEN) headers['Authorization'] = `Bearer ${process.env.CRAWL4AI_API_TOKEN}`;

  console.log(`[crawl4ai] POST ${endpoint} — scraping ${url}`);

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ urls: [url], crawler_config: { type: 'CrawlerRunConfig' } }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause?.code || err.cause?.message || err.cause})` : '';
    console.error(`[crawl4ai] network error reaching ${endpoint}: ${err.message}${cause}`);
    throw err;
  }

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[crawl4ai] HTTP ${resp.status} from ${endpoint}. Body: ${body.slice(0, 400)}`);
    throw new Error(`Crawl4AI error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json();
  console.log(`[crawl4ai] response top-level keys: ${Object.keys(json).join(', ')}`);

  // Handle both { results: [...] } and { result: {...} } response shapes
  const result = Array.isArray(json.results) ? json.results[0] : json.result;
  const md = result?.markdown || result?.markdown_v2?.raw_markdown || '';
  if (!md) {
    console.error(`[crawl4ai] no markdown in response. Full response (truncated): ${JSON.stringify(json).slice(0, 600)}`);
    throw new Error('Crawl4AI returned no markdown');
  }
  console.log(`[crawl4ai] markdown received: ${md.length} chars`);

  const prompt = `The following is the markdown of the Qualcomm news releases page. Extract the 3 most recent news release articles only.

URL: ${url}

Page markdown:
${md.slice(0, 30000)}

Return ONLY a JSON object with this exact shape (no markdown fences, no extra text):
{"articles": [{"title": "...", "url": "..."}]}

Rules:
- Only include actual news release articles — skip nav links, category headers, ads, and footer links.
- Make all article URLs absolute (prepend https://www.qualcomm.com if the path is relative).
- Return exactly the 3 most recent articles, ordered newest first.`;

  const raw = await generateText({ model, user: prompt, jsonMode: true, maxTokens: 500 });
  console.log(`[crawl4ai] gemini extraction raw: ${raw?.slice(0, 300)}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[crawl4ai] failed to parse Gemini JSON response:', raw?.slice(0, 300));
    return [];
  }

  const articles = (parsed.articles || [])
    .filter((a) => a?.title && a?.url)
    .slice(0, 3)
    .map((a) => {
      let articleUrl = String(a.url).trim();
      try { articleUrl = new URL(articleUrl, url).href; } catch { /* keep as-is */ }
      return { title: String(a.title).trim(), url: articleUrl, snippet: '', date: '' };
    });

  console.log(`[crawl4ai] extracted ${articles.length} article(s):`, articles.map((a) => a.title).join(' | '));
  return articles;
}

// Fetch an article URL directly and ask Gemini to summarise the page text.
async function summariseViaUrlContext(url, model, { useFirecrawl = false } = {}) {
  let text;
  try {
    if (useFirecrawl) {
      text = (await fetchViaFirecrawl(url)).slice(0, 12000);
    } else {
      const html = await fetchHtml(url);
      text = stripHtml(html).slice(0, 12000);
    }
  } catch (err) {
    throw new Error(`fetch failed: ${err.message}`);
  }
  return generateText({
    model,
    user: `Summarise this article in MINIMUM 100 words (target 120-160). Cover: what the development is, who is involved, the key technical or business details, and why it matters for the AI/technology industry. Be factual, dense, and concrete. Do not start with 'This article'. Output a single paragraph — no bullets, no headings.\n\nURL: ${url}\n\nArticle text:\n${text}`,
    maxTokens: 2000,
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
    maxTokens: 2000,
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
    const useCrawl4ai = src.scraper === 'crawl4ai' && !useRss;
    const useFirecrawl = src.scraper === 'firecrawl' && !useRss;
    const indexMode = useRss ? 'RSS' : (useCrawl4ai ? 'Crawl4AI + Gemini' : (useFirecrawl ? 'Firecrawl + Gemini' : 'fetch + Gemini'));
    console.log(`[${src.name}] scraping index via ${indexMode}…`);
    let raw;
    try {
      if (useRss) {
        raw = await scrapeIndexRss(src.rss);
      } else if (useCrawl4ai) {
        raw = await scrapeIndexViaCrawl4AI(src.url, config.models.scoring);
      } else {
        raw = await scrapeIndexViaUrlContext(src.url, config.models.scoring, { useFirecrawl });
      }
    } catch (err) {
      console.error(`[${src.name}] index scrape failed: ${err.message}`, err.cause ? `cause: ${err.cause?.code || err.cause?.message || err.cause}` : '', err.stack || '');
      errors.push({ source: src.name, stage: 'scrape', message: err.message });
      continue;
    }
    console.log(`[${src.name}] raw items extracted: ${raw.length}`);
    if (!raw.length) {
      console.warn(`[${src.name}] no items extracted — skipping source`);
      continue;
    }

    let picked;
    if (config.skipScoring) {
      picked = [...raw]
        .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
        .slice(0, config.maxItemsPerSource)
        .map((it) => ({ ...it, score: null }));
    } else {
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
    }

    const items = [];
    for (const it of picked) {
      let summary = '';
      if (!useCrawl4ai) {
        summary = it.snippet || '';
        if (useRss && it.body) {
          try {
            summary = await summarise(it.body, config.models.summarisation);
          } catch (err) {
            console.warn(`[${src.name}] summary failed: ${err.message}`);
          }
        } else {
          try {
            summary = await summariseViaUrlContext(it.url, config.models.summarisation, { useFirecrawl });
          } catch (err) {
            console.warn(`[${src.name}] article summary failed: ${err.message}`);
          }
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
