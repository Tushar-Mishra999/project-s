"""Feed pipeline — mirrors lib/feed.js behaviour exactly."""
import asyncio
import json
import feedparser
import httpx
from .llm import generate_text
from .rag import strip_json_fences
from .clients import config

_RSS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TechSensingBot/1.0)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

_MAX_PER_SOURCE = config.get("maxItemsPerSource", 5)
_MAX_BY_PART: dict = config.get("maxItemsPerSourceByPart", {})

# ── Per-part LLM filter prompts ───────────────────────────────────────────────

_PMO_FILTER = """You are a filter for a project management feed used by an R&D technology organization.
Keep articles about AI tools/automation applied to project management, AI-driven improvements to agile/scrum/PM workflows, AI capabilities affecting planning or delivery.
Discard general PM advice, generic agile tutorials, opinion/soft-skills without AI, company news without PM/AI relevance.
Return ONLY: {"relevant": true} or {"relevant": false}"""

_TECH_FILTER = """You are a filter for a tech-sensing feed used by an R&D technology organization.
Keep articles about new/emerging technologies, models, frameworks, tools, breakthroughs, AI/ML research, open-source releases with technical depth.
Discard general business news, consumer reviews, opinion pieces, regulatory/legal/political news.
Return ONLY: {"relevant": true} or {"relevant": false}"""

_WORKLET_TAG = """You are evaluating a news article headline for "worklet" suitability on a research platform.
A WORKLET is a focused 3-5 day hands-on engineering task (fine-tune, benchmark, prototype, reproduce).
Assign: "High" = concrete new model/technique/library an engineer can prototype directly.
"Medium" = tech-relevant but strategic, could inspire a worklet with extra framing.
"Low" = general business/policy/opinion without technical substance.
Return ONLY: {"relevance": "High" | "Medium" | "Low"}"""

_SCORE_SYSTEM = (
    'You are a relevance scorer. Given a department name and a news article (title + description), '
    'return ONLY JSON: {"score":7,"category":"AI Research"}. '
    'score is 1-10 relevance to that department. category is a short label.'
)


async def _fetch_rss(url: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=_RSS_HEADERS) as client:
            r = await client.get(url)
            r.raise_for_status()
            feed = feedparser.parse(r.text)
            items = []
            for entry in feed.entries[:15]:
                items.append({
                    "title": (entry.get("title") or "").strip(),
                    "url": (entry.get("link") or "").strip(),
                    "description": (entry.get("summary") or "")[:400],
                    "date": entry.get("published", ""),
                })
            return [a for a in items if a["title"] and a["url"]]
    except Exception as e:
        print(f"[feed] RSS fetch failed {url}: {e}")
        return []


async def _llm_bool(system: str, title: str, default: bool = True) -> bool:
    try:
        raw = await generate_text(system=system, user=f'Article headline: "{title}"',
                                  json_mode=True, max_tokens=64)
        parsed = json.loads(strip_json_fences(raw))
        return parsed.get("relevant", default) is not False
    except Exception:
        return default


async def _llm_tag(title: str) -> str | None:
    try:
        raw = await generate_text(system=_WORKLET_TAG,
                                  user=f'Classify this headline:\n\n"{title}"',
                                  json_mode=True, max_tokens=64)
        parsed = json.loads(strip_json_fences(raw))
        label = str(parsed.get("relevance", "")).strip()
        return label if label in ("High", "Medium", "Low") else None
    except Exception:
        return None


async def _score_article(part: str, title: str, description: str) -> dict:
    try:
        raw = await generate_text(
            system=_SCORE_SYSTEM,
            user=f"Department: {part}\nTitle: {title}\nDescription: {description[:300]}",
            json_mode=True, max_tokens=64,
        )
        data = json.loads(strip_json_fences(raw))
        return {"score": int(data.get("score", 5)), "category": data.get("category", "General")}
    except Exception:
        return {"score": 5, "category": "General"}


async def run_feed_pipeline(part: str | None) -> dict:
    sources = config.get("sources", [])
    if part:
        sources = [s for s in sources if part in s.get("parts", [])]

    max_items = _MAX_BY_PART.get(part, _MAX_PER_SOURCE) if part else _MAX_PER_SOURCE
    print(f"[feed] pipeline start — part={part} sources={len(sources)} max_items={max_items}")

    grouped: dict[str, list] = {}
    total = 0

    for src in sources:
        name = src["name"]
        print(f"[feed] === {name} ===")

        if src.get("geminiSearch"):
            print(f"[feed] skipping geminiSearch source: {name}")
            continue

        rss = src.get("rss")
        if not rss:
            continue

        articles = await _fetch_rss(rss)
        print(f"[feed] {name} → {len(articles)} articles fetched")
        if not articles:
            continue

        # Add source field to each article
        items = [{**a, "source": name, "summary": "", "workletRelevance": None} for a in articles]

        # Per-part filtering
        if part == "PMO" and items:
            flags = await asyncio.gather(*[_llm_bool(_PMO_FILTER, it["title"]) for it in items])
            before = len(items)
            items = [it for it, keep in zip(items, flags) if keep]
            print(f"[feed] {name} pmo-filter: kept {len(items)}/{before}")

        elif part == "Tech Management" and items:
            flags = await asyncio.gather(*[_llm_bool(_TECH_FILTER, it["title"]) for it in items])
            before = len(items)
            items = [it for it, keep in zip(items, flags) if keep]
            print(f"[feed] {name} tech-filter: kept {len(items)}/{before}")

        elif part == "PRISM" and items:
            labels = await asyncio.gather(*[_llm_tag(it["title"]) for it in items])
            for it, label in zip(items, labels):
                it["workletRelevance"] = label
            print(f"[feed] {name} worklet-tagged: {[l for l in labels if l]}")

        else:
            # MD and others — generic score + category
            scored = await asyncio.gather(*[
                _score_article(part or "General", a["title"], a["description"])
                for a in items
            ])
            items = sorted(
                [{**it, **sc} for it, sc in zip(items, scored)],
                key=lambda x: x.get("score", 0), reverse=True
            )

        items = items[:max_items]
        if items:
            grouped[name] = items
            total += len(items)
            print(f"[feed] {name} → {len(items)} items kept")

    print(f"[feed] pipeline done — {total} items across {len(grouped)} sources")
    return {
        "sources": grouped,
        "count": total,
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat(),
        "part": part,
    }


async def live_search(query: str) -> list[dict]:
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=10):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })
        return results
    except Exception:
        return []
