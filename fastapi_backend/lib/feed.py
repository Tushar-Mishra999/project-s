"""Feed pipeline — RSS-based. Replaces Gemini grounding with Ollama scoring."""
import asyncio
import json
import feedparser
import httpx
from .llm import generate_text
from .rag import strip_json_fences
from .clients import config

_SCORE_SYSTEM = (
    'You are a relevance scorer. Given a department name and a news article (title + description), '
    'return ONLY JSON: {"score":7,"category":"AI Research"}. '
    'score is 1-10 relevance to that department. category is a short label.'
)

_MAX_PER_SOURCE = config.get("maxItemsPerSource", 5)
_MAX_BY_PART: dict = config.get("maxItemsPerSourceByPart", {})


async def _fetch_rss(url: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            feed = feedparser.parse(r.text)
            items = []
            for entry in feed.entries[:15]:
                items.append({
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "pubDate": entry.get("published", ""),
                    "description": entry.get("summary", "")[:500],
                })
            return items
    except Exception:
        return []


async def _score_article(part: str, title: str, description: str) -> dict:
    try:
        raw = await generate_text(
            system=_SCORE_SYSTEM,
            user=f"Department: {part}\nTitle: {title}\nDescription: {description[:300]}",
            json_mode=True,
            max_tokens=64,
        )
        data = json.loads(strip_json_fences(raw))
        return {"score": int(data.get("score", 5)), "category": data.get("category", "General")}
    except Exception:
        return {"score": 5, "category": "General"}


async def run_feed_pipeline(part: str | None) -> dict:
    sources = config.get("sources", [])
    if part and part != "MD":
        sources = [s for s in sources if part in s.get("parts", [])]
    elif part == "MD":
        sources = [s for s in sources if "MD" in s.get("parts", [])]

    max_items = _MAX_BY_PART.get(part, _MAX_PER_SOURCE) if part else _MAX_PER_SOURCE
    all_sources = []

    for source in sources:
        if source.get("geminiSearch"):
            # No Gemini grounding available — skip or return empty for this source
            continue
        rss = source.get("rss")
        if not rss:
            continue
        articles = await _fetch_rss(rss)
        if not articles:
            continue

        scored = await asyncio.gather(*[
            _score_article(part or "General", a["title"], a["description"])
            for a in articles
        ])

        items = []
        for article, score_data in sorted(
            zip(articles, scored), key=lambda x: x[1]["score"], reverse=True
        )[:max_items]:
            items.append({**article, **score_data})

        if items:
            all_sources.append({
                "name": source["name"],
                "url": source.get("url", ""),
                "items": items,
            })

    return {"sources": all_sources, "generatedAt": __import__("datetime").datetime.utcnow().isoformat()}


async def live_search(query: str) -> list[dict]:
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=10):
                results.append({
                    "title": r.get("title", ""),
                    "link": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })
        return results
    except Exception:
        return []
