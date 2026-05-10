// Tech Sensing Feed pipeline — all sources use RSS feeds.
import Parser from 'rss-parser';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { URL as NodeURL } from 'node:url';
import { generateText } from './llm.js';

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

async function scrapeIndexRss(rssUrl, limit) {
  console.log(`[rss] fetching: ${rssUrl}`);
  let feed;
  try {
    feed = await rssParser.parseURL(rssUrl);
  } catch (firstErr) {
    // Some feeds have malformed XML entities — fetch raw, sanitize, then re-parse
    console.warn(`[rss] parseURL failed (${firstErr.message.split('\n')[0]}), retrying with sanitized fetch…`);
    const xml = await fetchRssRaw(rssUrl);
    feed = await rssParser.parseString(xml);
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
