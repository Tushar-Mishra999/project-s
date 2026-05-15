import re
import json
import math
from .llm import generate_text, embed_text, OLLAMA_MODEL
from .clients import get_supabase, config

_ENRICH_SYSTEM = (
    'Analyse the document chunk and return ONLY a JSON object:\n'
    '{"summary":"2-3 sentence abstract","keywords":["kw1","kw2"],"hypothetical_questions":["Q1?","Q2?","Q3?"]}'
)

_RERANK_SYSTEM = (
    'You are a relevance ranker. Given a query and numbered document chunk summaries, '
    'return a JSON array of the 5 most relevant 0-based indices in ranked order. '
    'Example: [2,0,4,1,3]. Return ONLY the JSON array.'
)


def strip_json_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return text.strip()


async def enrich_chunk(chunk_text: str) -> dict:
    try:
        raw = await generate_text(
            system=_ENRICH_SYSTEM,
            user=chunk_text[:4000],
            json_mode=True,
            max_tokens=512,
        )
        return json.loads(strip_json_fences(raw))
    except Exception:
        return {"summary": chunk_text[:200], "keywords": [], "hypothetical_questions": []}


def build_embedding_input(enriched: dict) -> str:
    parts = [enriched.get("summary", "")]
    kws = enriched.get("keywords", [])
    qs = enriched.get("hypothetical_questions", [])
    if kws:
        parts.append("Keywords: " + ", ".join(kws))
    if qs:
        parts.append("Questions: " + " | ".join(qs))
    return "\n".join(p for p in parts if p)


async def rerank_chunks(query: str, chunks: list[dict]) -> list[dict]:
    if len(chunks) <= config["rag"]["rerank_top_n"]:
        return chunks
    summaries = "\n".join(
        f"{i}. {c.get('chunk_summary') or (c.get('chunk_text') or '')[:300]}"
        for i, c in enumerate(chunks)
    )
    try:
        raw = await generate_text(
            system=_RERANK_SYSTEM,
            user=f"Query: {query}\n\nChunks:\n{summaries}",
            json_mode=True,
            max_tokens=128,
        )
        indices = json.loads(strip_json_fences(raw))
        if isinstance(indices, list):
            valid = [i for i in indices if isinstance(i, int) and 0 <= i < len(chunks)]
            if valid:
                return [chunks[i] for i in valid[: config["rag"]["rerank_top_n"]]]
    except Exception:
        pass
    return chunks[: config["rag"]["rerank_top_n"]]


async def retrieve(query: str, part_filter: str | None) -> list[dict]:
    sb = get_supabase()
    embedding = await embed_text(query)
    result = sb.rpc(
        "match_chunks",
        {
            "query_embedding": embedding,
            "part_filter": part_filter,
            "match_count": config["rag"]["vector_search_top_k"],
        },
    ).execute()
    chunks = result.data or []
    if not chunks:
        return []
    return await rerank_chunks(query, chunks)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return dot / (norm_a * norm_b + 1e-10)
