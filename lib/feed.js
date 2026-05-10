// Tech Sensing Feed pipeline — all sources use RSS feeds.
import Parser from 'rss-parser';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { URL as NodeURL } from 'node:url';
import { generateText, generateTextWithSearch } from './llm.js';

const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TechSensingBot/1.0; +https://github.com/Tushar-Mishra999/project-s)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

const rssParser = new Parser({
  timeout: 30000,
  headers: RSS_HEADERS,
});

function sanitizeXml(raw) {
  // Strip UTF-8 BOM if present
  const s = raw.startsWith('﻿') ? raw.slice(1) : raw;
  // Split on CDATA sections so we never corrupt their content
  const parts = s.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // inside CDATA — leave untouched
    // Escape bare & that are not already a valid XML entity or char reference
    return part.replace(/&(?!(?:#\d+|#x[\da-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;');
  }).join('');
}

// Use the same Node http/https stack as rss-parser so we get identical bytes,
// then sanitize malformed entities before handing to parseString.
function fetchRssRaw(rssUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new NodeURL(rssUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search,
        headers: { ...RSS_HEADERS, 'Accept-Encoding': 'gzip, deflate' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          return fetchRssRaw(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode >= 400) return reject(new Error(`Status code ${res.statusCode}`));
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(sanitizeXml(Buffer.concat(chunks).toString('utf-8'))));
        stream.on('error', reject);
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error('RSS fetch timeout')));
    req.on('error', reject);
  });
}

async function scrapeViaGeminiSearch(src, limit, model) {
  console.log(`[gemini-search] both RSS attempts failed for ${src.name} — falling back to Gemini grounded search`);
  const domain = new NodeURL(src.url).hostname.replace(/^www\./, '');

  const prompt = `Use Google Search to find the ${limit} most recent news articles published on ${src.name} (${src.url}).

Return ONLY a valid JSON array — no markdown, no explanation, nothing else:
[{"title":"article headline","url":"https://..."},{"title":"...","url":"https://..."}]

Requirements:
- URLs must be from ${domain}
- Each URL must link to a specific article, not the homepage or a category page
- Return up to ${limit} results`;

  const { text, groundingChunks } = await generateTextWithSearch({ model, user: prompt, maxTokens: 1024 });
  console.log(`[gemini-search] ${src.name}: ${groundingChunks.length} grounding chunk(s), text length=${text.length}`);

  // 1. Grounding chunks — actual URLs Gemini retrieved from Search
  const fromChunks = groundingChunks
    .map((c) => ({ title: (c.web?.title || '').trim(), url: (c.web?.uri || '').trim() }))
    .filter((a) => a.url && a.url.includes(domain) && !isIndexPage(a.url, domain))
    .map((a) => ({ ...a, title: a.title || urlToTitle(a.url) }))
    .slice(0, limit);

  if (fromChunks.length > 0) {
    console.log(`[gemini-search] ${src.name}: got ${fromChunks.length} article(s) from grounding chunks`);
    return fromChunks;
  }

  // 2. Parse Gemini's JSON text response
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const articles = parsed
      .map((a) => ({ title: (a.title || '').trim(), url: (a.url || '').trim() }))
      .filter((a) => a.title && a.url)
      .slice(0, limit);
    if (articles.length > 0) {
      console.log(`[gemini-search] ${src.name}: got ${articles.length} article(s) from JSON text`);
      return articles;
    }
  } catch (jsonErr) {
    console.warn(`[gemini-search] ${src.name}: JSON parse failed (${jsonErr.message}), trying URL regex…`);
  }

  // 3. Regex: extract any article URLs mentioned in Gemini's text response
  const urlRe = /https?:\/\/(?:www\.)?[^\s"')>]+/g;
  const urlMatches = [...(text.matchAll(urlRe))]
    .map((m) => m[0].replace(/[.,;)>]+$/, ''))
    .filter((u) => u.includes(domain) && !isIndexPage(u, domain));
  const deduped = [...new Set(urlMatches)].slice(0, limit);
  const fromRegex = deduped.map((u) => ({ title: urlToTitle(u), url: u }));
  if (fromRegex.length > 0) {
    console.log(`[gemini-search] ${src.name}: got ${fromRegex.length} article(s) from URL regex`);
    return fromRegex;
  }

  console.warn(`[gemini-search] ${src.name}: no articles found. Gemini response:\n${text.slice(0, 400)}`);
  return [];
}

function isIndexPage(url, domain) {
  try {
    const { pathname } = new NodeURL(url);
    // Reject homepage, year-only paths, tag/category/author pages
    return /^\/?$|^\/\d{4}\/?$|^\/(tag|category|author|page)\//i.test(pathname);
  } catch { return false; }
}

function urlToTitle(url) {
  try {
    const slug = new NodeURL(url).pathname.split('/').filter(Boolean).pop() || '';
    return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch { return url; }
}

async function scrapeIndexRss(src, limit, scoringModel) {
  const { rss: rssUrl, url: srcUrl, name: srcName } = src;
  console.log(`[rss] fetching: ${rssUrl}`);
  let feed;
  try {
    feed = await rssParser.parseURL(rssUrl);
  } catch (firstErr) {
    console.warn(`[rss] parseURL failed (${firstErr.message.split('\n')[0]}), retrying with sanitized fetch…`);
    try {
      const xml = await fetchRssRaw(rssUrl);
      feed = await rssParser.parseString(xml);
    } catch (secondErr) {
      console.warn(`[rss] sanitized fetch also failed (${secondErr.message.split('\n')[0]}), trying Gemini search…`);
      return scrapeViaGeminiSearch(src, limit, scoringModel);
    }
  }
  const articles = (feed.items || [])
    .slice(0, limit)
    .map((item) => ({ title: (item.title || '').trim(), url: (item.link || '').trim() }))
    .filter((a) => a.title && a.url);
  console.log(`[rss] got ${articles.length} article(s):`, articles.map((a) => a.title).join(' | '));
  return articles;
}

const SINGLE_ARTICLE_TAG_PROMPT = `You are evaluating a news article headline for "worklet" suitability on a research-and-development platform.

A WORKLET is a focused 3-5 day research/engineering task that an engineer or strong intern can pick up. Worklets typically involve hands-on building, fine-tuning, benchmarking, or prototyping around an emerging technology, model, framework, or technique. Examples: "fine-tune a small model on a domain dataset", "benchmark a new vector DB", "implement a paper's algorithm and reproduce its results", "prototype an inference optimisation".

Based on the headline, assign one relevance tag:
- "High": describes a concrete new model, technique, library, dataset, paper, or capability that an engineer could directly turn into a hands-on prototype, benchmark, or reproduction. Specific and technical.
- "Medium": tech-relevant but more strategic, partial, or industry-news flavoured — could inspire a worklet with extra framing.
- "Low": general business/policy/consumer news, opinion pieces, funding announcements, or anything without enough technical substance to build on.

Return ONLY a JSON object with shape: {"relevance": "High" | "Medium" | "Low"}`;

const VALID_TAGS = new Set(['high', 'medium', 'low']);

async function tagArticleRelevance(title, model) {
  const userMsg = `Classify this article headline:\n\n"${title}"`;

  let raw;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = await generateText({
        model,
        system: SINGLE_ARTICLE_TAG_PROMPT,
        user: userMsg,
        jsonMode: true,
        maxTokens: 1000,
      });
      if (raw && raw.trim()) break;
      console.warn(`[article-tag] attempt ${attempt} empty for "${title}", retrying…`);
    } catch (err) {
      console.warn(`[article-tag] attempt ${attempt} threw for "${title}": ${err.message}`);
      if (attempt === 3) throw err;
    }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }

  if (!raw || !raw.trim()) {
    console.warn(`[article-tag] all attempts empty for "${title}" — returning null`);
    return null;
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    const rawLabel = String(
      parsed.relevance ?? parsed.relevance_level ?? parsed.label ?? parsed.score ?? parsed.classification ?? ''
    ).trim();
    if (VALID_TAGS.has(rawLabel.toLowerCase())) {
      return rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
    }
    console.warn(`[article-tag] unexpected label "${rawLabel}" for "${title}"`);
    return null;
  } catch {
    const m = cleaned.match(/\b(high|medium|low)\b/i);
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    console.warn(`[article-tag] parse failed for "${title}". raw:`, raw.slice(0, 200));
    return null;
  }
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
      articles = await scrapeIndexRss(src, limit, config.models.scoring);
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
      console.log(`[pipeline] tagging worklet relevance for ${src.name} (${items.length} items individually)…`);
      const labels = await Promise.all(
        items.map((it) =>
          tagArticleRelevance(it.title, config.models.scoring).catch((err) => {
            console.warn(`[pipeline] tag failed for "${it.title}": ${err.message}`);
            return null;
          })
        )
      );
      items.forEach((it, i) => { it.workletRelevance = labels[i]; });
      const scored = labels.filter(Boolean).length;
      console.log(`[pipeline] ${src.name} tagged ${scored}/${items.length}: ${labels.join(', ')}`);
    }

    grouped[src.name] = items;
    total += items.length;
  }

  return { grouped, total, errors };
}
