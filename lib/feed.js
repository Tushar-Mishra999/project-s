// Tech Sensing Feed pipeline — all sources use RSS feeds.
import Parser from 'rss-parser';
import https from 'node:https';
import http from 'node:http';
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

function makeGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { ...RSS_HEADERS, ...extraHeaders } }, (res) => {
      const setCookies = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: res.headers['content-type'] || '',
        location: res.headers['location'] || null,
        cookies: setCookies.join('; '),
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
      res.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error('RSS fetch timeout')));
    req.on('error', reject);
  });
}

function extractMetaRefreshUrl(html, baseUrl) {
  const m = html.match(/http-equiv="refresh"[^>]+content="[^;]*;\s*([^"]+)"/i)
    || html.match(/content="[^;]*;\s*([^"]+)"[^>]+http-equiv="refresh"/i);
  if (!m) return null;
  const href = m[1].trim();
  if (href.startsWith('http')) return href;
  const base = new NodeURL(baseUrl);
  return `${base.protocol}//${base.host}${href.startsWith('/') ? '' : '/'}${href}`;
}

async function fetchRssRaw(rssUrl) {
  console.log(`[rss-raw] GET ${rssUrl}`);
  let resp = await makeGet(rssUrl);
  console.log(`[rss-raw] status=${resp.status} content-type="${resp.contentType}" body[0:250]:\n${resp.body.slice(0, 250)}`);

  // SiteGround bot-protection: 202 + meta-refresh to /.well-known/sgcaptcha/
  // It uses no JS — following the redirect and sending back the cookie is enough.
  if (resp.body.includes('sgcaptcha')) {
    const captchaUrl = extractMetaRefreshUrl(resp.body, rssUrl);
    console.log(`[rss-raw] SiteGround captcha detected — following: ${captchaUrl}`);
    if (captchaUrl) {
      const captchaResp = await makeGet(captchaUrl);
      console.log(`[rss-raw] captcha resp status=${captchaResp.status} cookies="${captchaResp.cookies}" location="${captchaResp.location}"`);
      const cookie = captchaResp.cookies;
      if (cookie) {
        console.log(`[rss-raw] retrying feed with captcha cookie…`);
        resp = await makeGet(rssUrl, { Cookie: cookie });
        console.log(`[rss-raw] retry status=${resp.status} body[0:250]:\n${resp.body.slice(0, 250)}`);
      }
    }
  }

  if (resp.status >= 400) throw new Error(`Status code ${resp.status}`);
  const sanitized = sanitizeXml(resp.body);
  console.log(`[rss-raw] sanitized XML first 200:\n${sanitized.slice(0, 200)}`);
  return sanitized;
}

async function scrapeViaGeminiSearch(src, limit, model) {
  console.log(`[gemini-search] both RSS attempts failed for ${src.name} — falling back to Gemini grounded search`);
  const domain = new NodeURL(src.url).hostname.replace(/^www\./, '');

  const prompt = `Use Google Search grounding ONLY to inspect this webpage:

${src.url}

Task:
Extract up to ${limit} article links directly from this page.

Requirements:
- ONLY use article links visible on this page
- Do NOT search the broader web
- Do NOT use homepage URLs
- Do NOT use category/tag/archive pages
- Return ONLY URLs from ${domain}
- Prefer the newest articles shown on the page

Return ONLY valid JSON:

[
  {
    "title": "Article title",
    "url": "https://..."
  }
]`;

  const { text, groundingChunks } = await generateTextWithSearch({ model, user: prompt, maxTokens: 1024 });
  console.log(`[gemini-search] ${src.name}: ${groundingChunks.length} grounding chunk(s), text length=${text.length}`);
  console.log(`[gemini-search] ${src.name} raw text response:\n${text}`);
  console.log(`[gemini-search] ${src.name} grounding chunks:\n${JSON.stringify(groundingChunks, null, 2)}`);

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
  const { rss: rssUrl } = src;
  console.log(`[rss] fetching: ${rssUrl}`);
  let feed;
  try {
    console.log(`[rss] attempting parseURL…`);
    feed = await rssParser.parseURL(rssUrl);
    console.log(`[rss] parseURL succeeded, ${feed.items?.length ?? 0} items`);
  } catch (firstErr) {
    console.warn(`[rss] parseURL failed: ${firstErr.message}`);
    try {
      console.log(`[rss] attempting sanitized raw fetch…`);
      const xml = await fetchRssRaw(rssUrl);
      console.log(`[rss] calling parseString on sanitized XML (${xml.length} chars)…`);
      feed = await rssParser.parseString(xml);
      console.log(`[rss] parseString succeeded, ${feed.items?.length ?? 0} items`);
    } catch (secondErr) {
      console.warn(`[rss] parseString failed: ${secondErr.message}`);
      console.warn(`[rss] both RSS attempts exhausted, trying Gemini search…`);
      return scrapeViaGeminiSearch(src, limit, scoringModel);
    }
  }
  const articles = (feed.items || [])
    .slice(0, limit)
    .map((item) => ({
      title: (item.title || '').trim(),
      url: (item.link || '').trim(),
      description: (item.contentSnippet || item.summary || item.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 400),
    }))
    .filter((a) => a.title && a.url);
  console.log(`[rss] got ${articles.length} article(s):`, articles.map((a) => a.title).join(' | '));
  return articles;
}

const PMO_AI_FILTER_PROMPT = `You are a filter for a project management feed used by an R&D technology organization.

Your job: decide whether a news article is worth showing to project managers and delivery leads who care specifically about AI's impact on project management.

Keep articles that are about:
- AI tools or automation applied to project management, planning, or delivery
- AI-driven improvements to agile, scrum, or PM workflows
- Emerging AI capabilities that directly affect how teams plan, track, or deliver work
- Research or case studies on AI in project management

Discard articles that are:
- General project management advice without an AI angle
- Generic agile or scrum tutorials not related to AI
- Opinion pieces or soft-skills content without AI substance
- Company news or funding without direct PM/AI relevance

Return ONLY a JSON object: {"relevant": true} or {"relevant": false}`;

async function filterArticleForPMO(title, model) {
  const userMsg = `Article headline: "${title}"`;
  let raw;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = await generateText({
        model,
        system: PMO_AI_FILTER_PROMPT,
        user: userMsg,
        maxTokens: 1000,
      });
      if (raw && raw.trim()) break;
    } catch (err) {
      console.warn(`[pmo-filter] attempt ${attempt} threw for "${title}": ${err.message}`);
      if (attempt === 3) return true;
    }
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
  if (!raw || !raw.trim()) return true;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed.relevant !== false;
  } catch {
    const m = raw.match(/\b(true|false)\b/i);
    return m ? m[1].toLowerCase() !== 'false' : true;
  }
}

const TECH_SENSING_FILTER_PROMPT = `You are a filter for a tech-sensing feed used by an R&D technology organization.

Your job: decide whether a news article is worth showing to R&D engineers and tech leaders.

Keep articles that are about:
- New or emerging technologies, models, frameworks, or tools
- Technology advancements, breakthroughs, or research findings
- New capabilities, benchmarks, or techniques in AI/ML, software, hardware, or engineering
- Open-source releases or significant product launches with technical depth

Discard articles that are:
- General business news, funding rounds, or company strategy without technical substance
- Consumer product reviews or lifestyle tech
- Opinion pieces or commentary without new technical information
- Regulatory, legal, or political news about tech companies

Return ONLY a JSON object: {"relevant": true} or {"relevant": false}`;

async function filterArticleForTechSensing(title, model) {
  const userMsg = `Article headline: "${title}"`;
  let raw;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = await generateText({
        model,
        system: TECH_SENSING_FILTER_PROMPT,
        user: userMsg,
        maxTokens: 1000,
      });
      if (raw && raw.trim()) break;
    } catch (err) {
      console.warn(`[tech-filter] attempt ${attempt} threw for "${title}": ${err.message}`);
      if (attempt === 3) return true; // fail open — keep article on error
    }
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
  if (!raw || !raw.trim()) return true;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed.relevant !== false;
  } catch {
    const m = raw.match(/\b(true|false)\b/i);
    return m ? m[1].toLowerCase() !== 'false' : true;
  }
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

    if (!src.rss && !src.geminiSearch) {
      console.warn(`[pipeline] ${src.name} — no RSS feed or geminiSearch configured, skipping`);
      continue;
    }

    let articles;
    try {
      articles = src.geminiSearch
        ? await scrapeViaGeminiSearch(src, limit, config.models.scoring)
        : await scrapeIndexRss(src, limit, config.models.scoring);
    } catch (err) {
      console.error(`[pipeline] ${src.name} scrape failed: ${err.message}`, err.stack || '');
      errors.push({ source: src.name, stage: 'scrape', message: err.message });
      continue;
    }

    if (!articles.length) {
      console.warn(`[pipeline] ${src.name} — no articles extracted, skipping`);
      continue;
    }

    let items = articles.map((a) => ({
      title: a.title,
      url: a.url,
      description: a.description || '',
      source: src.name,
      date: '',
      summary: '',
      score: null,
      workletRelevance: null,
    }));

    if (config.part === 'PMO' && items.length) {
      console.log(`[pipeline] filtering PMO AI relevance for ${src.name} (${items.length} items)…`);
      const flags = await Promise.all(
        items.map((it) =>
          filterArticleForPMO(it.title, config.models.scoring).catch(() => true)
        )
      );
      const before = items.length;
      items = items.filter((_, i) => flags[i]);
      console.log(`[pipeline] ${src.name} pmo-filter: kept ${items.length}/${before}`);
    } else if (config.part === 'Tech Management' && items.length) {
      console.log(`[pipeline] filtering tech-sensing relevance for ${src.name} (${items.length} items)…`);
      const flags = await Promise.all(
        items.map((it) =>
          filterArticleForTechSensing(it.title, config.models.scoring).catch(() => true)
        )
      );
      const before = items.length;
      items = items.filter((_, i) => flags[i]);
      console.log(`[pipeline] ${src.name} tech-filter: kept ${items.length}/${before}`);
    } else if (config.part === 'PRISM' && items.length) {
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
