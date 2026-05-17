"""FastAPI backend — Ollama LLM + ChromaDB vectors + psycopg2 PostgreSQL."""
from __future__ import annotations
import os, json, uuid, re, io, asyncio, tempfile, shutil
from pathlib import Path
from datetime import datetime, date
from typing import Any

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, File, Form, UploadFile, Request, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from lib.clients import rag_ready, config, get_chunks_collection, get_chatroom_collection, neo4j_ready, init_neo4j_constraints
from lib.db import fetch_all, fetch_one, execute, execute_returning
from psycopg2.extras import Json
from lib.llm import generate_text, generate_chat, generate_chat_stream, embed_text, OLLAMA_MODEL
from lib.rag import retrieve, rerank_chunks, enrich_chunk, build_embedding_input, strip_json_fences, cosine_similarity
from lib.extract import extract_text as extract_file_text
from lib.chunk import chunk_document, add_context_prefix
from lib.render import render_pdf, render_docx, render_xlsx
from lib.action_items import extract_action_items
from lib.feed import run_feed_pipeline, live_search
from lib.graph import extract_entities, write_document_to_graph, delete_document_from_graph, route_query, graph_search

app = FastAPI(title="Kernel FastAPI Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def _startup():
    init_neo4j_constraints()

# ── Local file storage ────────────────────────────────────────────────────────
_LOCAL_UPLOADS_DIR = Path(__file__).parent / "uploads"
_PORT = int(os.getenv("PORT", 10000))
_LOCAL_UPLOADS_DIR.mkdir(exist_ok=True)

def storage_upload(storage_path: str, file_bytes: bytes, content_type: str = "application/octet-stream") -> str:
    safe_name = storage_path.replace("/", "_")
    dest = _LOCAL_UPLOADS_DIR / safe_name
    dest.write_bytes(file_bytes)
    return f"http://localhost:{_PORT}/uploads/{safe_name}"

def storage_delete(file_url: str) -> None:
    try:
        filename = file_url.split("/uploads/")[-1]
        path = _LOCAL_UPLOADS_DIR / filename
        if path.exists():
            path.unlink()
    except Exception:
        pass

# ── Static frontend ──────────────────────────────────────────────────────────
_DIST = Path(__file__).parent.parent / "client" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")
app.mount("/uploads", StaticFiles(directory=str(_LOCAL_UPLOADS_DIR)), name="uploads")

# ── Helpers ──────────────────────────────────────────────────────────────────

def _ok() -> dict:
    r = rag_ready()
    if not r["ok"]:
        raise HTTPException(503, f"RAG not configured: {', '.join(r['missing'])}")
    return r

def user_scope(user: dict) -> tuple[str | None, bool]:
    if not user:
        return None, False
    if user.get("role") == "MD":
        return None, True
    return user.get("part") or user.get("team"), False

async def load_user(user_id: str | None) -> dict | None:
    if not user_id:
        return None
    return fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))

async def resolve_part_filter(user_id: str | None, part: str | None = None) -> str | None:
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if is_all:
            return None
        if not scope:
            raise HTTPException(400, "user has no part/team scope")
        return scope
    return part or None

def is_exec_user(user: dict) -> bool:
    return user.get("role") in ("MD", "PartHead")

def conv_id(a: str, b: str) -> str:
    return "__".join(sorted([a, b]))

_memory_feed_cache: dict = {}
_pipeline_running: set = set()
_leaderboard_cache: dict = {"data": None, "fetched_at": None}
_LEADERBOARD_TTL = 3600  # seconds

def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

# ─────────────────────────────────────────────────────────────────────────────
# 1. FEED
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/feed")
async def get_feed(part: str | None = None):
    key = f"part:{part}" if part else "latest"

    # Return cached data immediately if available
    if key in _memory_feed_cache:
        return _memory_feed_cache[key]
    try:
        r = fetch_one("SELECT data, generated_at FROM feed_cache WHERE id = %s", (key,))
        if r:
            cached = {**r["data"], "generatedAt": str(r["generated_at"])}
            _memory_feed_cache[key] = cached
            return cached
    except Exception:
        pass

    # No cache — trigger background pipeline and tell frontend to poll
    if key not in _pipeline_running:
        _pipeline_running.add(key)
        async def _run():
            try:
                payload = await run_feed_pipeline(part)
                _memory_feed_cache[key] = payload
                try:
                    execute("""
                        INSERT INTO feed_cache (id, data, generated_at, updated_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            data = EXCLUDED.data,
                            generated_at = EXCLUDED.generated_at,
                            updated_at = EXCLUDED.updated_at
                    """, (key, Json(payload), payload.get("generatedAt"), datetime.utcnow().isoformat()))
                except Exception:
                    pass
            finally:
                _pipeline_running.discard(key)
        asyncio.create_task(_run())

    return {"sources": [], "generatedAt": None, "pipelineRunning": True}

@app.get("/api/feed/sources")
def get_feed_sources(part: str | None = None):
    sources = config.get("sources", [])
    if part:
        sources = [s for s in sources if part in s.get("parts", [])]
    return {"sources": sources}

@app.post("/api/feed/sources")
async def add_feed_source(req: Request):
    body = await req.json()
    config.setdefault("sources", []).append(body)
    return {"ok": True}

@app.post("/api/feed/refresh")
async def refresh_feed(req: Request):
    body = await req.json()
    part = body.get("part")
    key = f"part:{part}" if part else "latest"
    if key not in _pipeline_running:
        _pipeline_running.add(key)
        async def _run():
            try:
                payload = await run_feed_pipeline(part)
                _memory_feed_cache[key] = payload
                try:
                    execute("""
                        INSERT INTO feed_cache (id, data, generated_at, updated_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            data = EXCLUDED.data,
                            generated_at = EXCLUDED.generated_at,
                            updated_at = EXCLUDED.updated_at
                    """, (key, Json(payload), payload.get("generatedAt"), datetime.utcnow().isoformat()))
                except Exception:
                    pass
            finally:
                _pipeline_running.discard(key)
        asyncio.create_task(_run())
    return {"ok": True, "message": "Feed refresh started", "pipelineRunning": key in _pipeline_running}

@app.get("/api/leaderboard")
async def get_leaderboard():
    import time, re as _re
    from lib.llm import _client, GEMINI_MODEL
    from google.genai import types as _gtypes

    now_ts = time.time()

    # In-memory cache
    if _leaderboard_cache["data"] and _leaderboard_cache["fetched_at"] and (now_ts - _leaderboard_cache["fetched_at"] < _LEADERBOARD_TTL):
        print("[leaderboard] returning cached data")
        return _leaderboard_cache["data"]

    # DB cache
    try:
        row = fetch_one("SELECT data, generated_at FROM feed_cache WHERE id = %s", ("leaderboard",))
        if row and row["data"] and row["generated_at"]:
            age = now_ts - row["generated_at"].timestamp() if hasattr(row["generated_at"], "timestamp") else _LEADERBOARD_TTL + 1
            if age < _LEADERBOARD_TTL:
                print("[leaderboard] returning DB-cached data")
                _leaderboard_cache["data"] = row["data"]
                _leaderboard_cache["fetched_at"] = row["generated_at"].timestamp()
                return row["data"]
    except Exception as e:
        print(f"[leaderboard] DB cache check failed: {e}")

    prompt = """Search the current Open LLM Leaderboard tier rankings from onyx.app (https://onyx.app/open-llm-leaderboard).

Extract the tier-based model rankings for only 1 category: Overall.

Return a JSON array with this exact structure:
[
  {"tier": "S", "models": [{"name": "", "params": ""}]},
  {"tier": "A", "models": [{"name": "", "params": ""}]},
  {"tier": "B", "models": [{"name": "", "params": ""}]},
  {"tier": "C", "models": [{"name": "", "params": ""}]},
  {"tier": "D", "models": [{"name": "", "params": ""}]}
]

Each model object must have:
- "name": model name string
- "params": parameter count string like "744B", "1T", "27B" (or null if unknown)

Include all tiers S, A, B, C, D (empty models array if no models in that tier).
Return ONLY the JSON array, no markdown fences, no explanation, no extra text."""

    print("[leaderboard] calling Gemini with Google Search grounding...")
    try:
        cfg = _gtypes.GenerateContentConfig(
            max_output_tokens=2500,
            system_instruction="You are a data extraction assistant. Return only valid JSON objects. No markdown, no explanation.",
            tools=[_gtypes.Tool(google_search=_gtypes.GoogleSearch())],
        )
        resp = await _client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=cfg,
        )

        raw_text = ""
        if resp.text:
            raw_text = resp.text
        elif resp.candidates:
            parts = resp.candidates[0].content.parts if resp.candidates[0].content else []
            raw_text = "".join(p.text or "" for p in parts)
        raw_text = raw_text.strip()

        print(f"[leaderboard] raw response length: {len(raw_text)}")
        print(f"[leaderboard] raw response (first 500 chars): {raw_text[:500]}")

        if not raw_text:
            print("[leaderboard] empty response from Gemini")
            raise HTTPException(500, "Empty response from AI model")

        cleaned = _re.sub(r'```json\s*', '', raw_text, flags=_re.IGNORECASE)
        cleaned = _re.sub(r'```\s*', '', cleaned).strip()
        print(f"[leaderboard] cleaned (first 500 chars): {cleaned[:500]}")

        tiers = None
        try:
            tiers = json.loads(cleaned)
        except Exception as e1:
            print(f"[leaderboard] direct parse failed: {e1}")
            arr_match = _re.search(r'\[[\s\S]*\]', cleaned)
            if arr_match:
                try:
                    tiers = json.loads(arr_match.group(0))
                    print("[leaderboard] extracted array from text, parsed OK")
                except Exception as e2:
                    print(f"[leaderboard] array extraction parse failed: {e2}")
                    raise HTTPException(500, "Failed to parse leaderboard data from AI")
            else:
                print("[leaderboard] no JSON array found in response")
                raise HTTPException(500, "Failed to parse leaderboard data — no JSON array in response")

        if not isinstance(tiers, list):
            print(f"[leaderboard] parsed result is not an array: {type(tiers)}")
            raise HTTPException(500, "AI returned unexpected data format")

        print(f"[leaderboard] success — got {len(tiers)} tiers")
        now_iso = datetime.utcnow().isoformat()
        payload = {"tiers": tiers, "fetchedAt": now_iso}
        _leaderboard_cache["data"] = payload
        _leaderboard_cache["fetched_at"] = now_ts
        try:
            execute("""
                INSERT INTO feed_cache (id, data, generated_at, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    data = EXCLUDED.data,
                    generated_at = EXCLUDED.generated_at,
                    updated_at = EXCLUDED.updated_at
            """, ("leaderboard", Json(payload), now_iso, now_iso))
        except Exception as e:
            print(f"[leaderboard] cache write error: {e}")
        return payload

    except HTTPException:
        raise
    except Exception as err:
        print(f"[leaderboard] error: {err}")
        raise HTTPException(500, str(err) or "Failed to fetch leaderboard")

@app.post("/api/worklet")
async def generate_worklet(req: Request):
    body = await req.json()
    result = await generate_text(
        system="You are a technical analyst. Write a 130-160 word digest of the article suitable for a briefing note. Be factual and precise.",
        user=f"Title: {body.get('title','')}\nURL: {body.get('url','')}",
        max_tokens=512,
    )
    return {"worklet": result}

@app.post("/api/feed/live-search")
async def feed_live_search(req: Request):
    body = await req.json()
    results = await live_search(body.get("query", ""))
    return {"results": results}

# ─────────────────────────────────────────────────────────────────────────────
# 2. ACTION ITEMS
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/action-items/extract/{file_id}")
async def extract_action_items_preview(file_id: str, req: Request):
    _ok()
    f = fetch_one("SELECT id, filename, accessible_to FROM files WHERE id = %s", (file_id,))
    if not f:
        raise HTTPException(404, "file not found")
    chunks_rows = fetch_all("SELECT chunk_text FROM chunks WHERE file_id = %s ORDER BY chunk_index", (file_id,))
    text = "\n\n".join(c["chunk_text"] for c in chunks_rows)
    items = await extract_action_items(text)
    return {"source_type": "file", "source_id": file_id, "filename": f["filename"],
            "accessible_to": f.get("accessible_to") or [], "items": items}

@app.post("/api/action-items")
async def save_action_items(req: Request):
    _ok()
    body = await req.json()
    row = execute_returning("""
        INSERT INTO action_items (file_id, filename, accessible_to, items, assigned_by, source_type, source_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *
    """, (body.get("file_id"), body.get("filename"), body.get("accessible_to", []),
          Json(body.get("items", [])), body.get("assigned_by"),
          body.get("source_type", "file"), body.get("source_id")))
    return {"action_item": row}

@app.get("/api/action-items")
async def list_action_items(user_id: str | None = None, part: str | None = None):
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if is_all:
            rows = fetch_all("SELECT * FROM action_items ORDER BY created_at DESC")
        elif scope:
            rows = fetch_all(
                "SELECT * FROM action_items WHERE accessible_to @> ARRAY[%s] ORDER BY created_at DESC", (scope,))
        else:
            return {"action_items": []}
    elif part:
        rows = fetch_all(
            "SELECT * FROM action_items WHERE accessible_to @> ARRAY[%s] ORDER BY created_at DESC", (part,))
    else:
        rows = fetch_all("SELECT * FROM action_items ORDER BY created_at DESC")
    return {"action_items": rows}

_AI_SAFE_COLS = {"items", "assigned_by", "accessible_to", "filename"}

@app.patch("/api/action-items/{item_id}")
async def update_action_item(item_id: str, req: Request):
    body = await req.json()
    updates = {k: v for k, v in body.items() if k in _AI_SAFE_COLS}
    if not updates:
        raise HTTPException(400, "no valid fields to update")
    set_parts = ", ".join(f"{k} = %s" for k in updates)
    vals = [Json(v) if k == "items" else v for k, v in updates.items()]
    row = execute_returning(f"UPDATE action_items SET {set_parts} WHERE id = %s RETURNING *", vals + [item_id])
    return {"action_item": row}

@app.delete("/api/action-items/{item_id}")
async def delete_action_item(item_id: str):
    execute("DELETE FROM action_items WHERE id = %s", (item_id,))
    return {"ok": True}

# ─────────────────────────────────────────────────────────────────────────────
# 3. FILES + UPLOAD
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/parts")
def get_parts():
    return {"parts": config.get("parts", [])}

@app.get("/api/files")
async def list_files(user_id: str | None = None, part: str | None = None):
    _ok()
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if is_all:
            rows = fetch_all("SELECT * FROM files ORDER BY uploaded_at DESC")
        elif scope:
            rows = fetch_all(
                "SELECT * FROM files WHERE accessible_to @> ARRAY[%s] ORDER BY uploaded_at DESC", (scope,))
        else:
            return {"files": []}
    elif part:
        rows = fetch_all(
            "SELECT * FROM files WHERE accessible_to @> ARRAY[%s] ORDER BY uploaded_at DESC", (part,))
    else:
        rows = fetch_all("SELECT * FROM files ORDER BY uploaded_at DESC")
    return {"files": rows}

@app.post("/api/files/{file_id}/lock")
async def lock_file(file_id: str, req: Request):
    _ok()
    body = await req.json()
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id required")
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    f = fetch_one("SELECT id, locked_by_id, locked_by_name, locked_at FROM files WHERE id = %s", (file_id,))
    if not f:
        raise HTTPException(404, "file not found")
    if f.get("locked_by_id") and f["locked_by_id"] != user_id:
        raise HTTPException(409, f"Locked by {f.get('locked_by_name', 'another user')}")
    updated = execute_returning("""
        UPDATE files SET locked_by_id = %s, locked_by_name = %s, locked_at = %s
        WHERE id = %s RETURNING *
    """, (user_id, user["name"], datetime.utcnow().isoformat(), file_id))
    return {"file": updated}

@app.post("/api/files/{file_id}/unlock")
async def unlock_file(file_id: str, req: Request):
    _ok()
    body = await req.json()
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id required")
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    f = fetch_one("SELECT id, locked_by_id FROM files WHERE id = %s", (file_id,))
    if not f:
        raise HTTPException(404, "file not found")
    if f.get("locked_by_id") and f["locked_by_id"] != user_id and user.get("role") != "MD":
        raise HTTPException(403, "only the lock holder or MD can release this lock")
    updated = execute_returning("""
        UPDATE files SET locked_by_id = NULL, locked_by_name = NULL, locked_at = NULL
        WHERE id = %s RETURNING *
    """, (file_id,))
    return {"file": updated}

@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str):
    _ok()
    f = fetch_one("SELECT id, file_url FROM files WHERE id = %s", (file_id,))
    if not f:
        raise HTTPException(404, "file not found")
    if f.get("file_url"):
        storage_delete(f["file_url"])
    col = get_chunks_collection()
    existing = col.get(where={"file_id": {"$eq": file_id}})
    if existing["ids"]:
        col.delete(ids=existing["ids"])
    execute("DELETE FROM chunks WHERE file_id = %s", (file_id,))
    execute("DELETE FROM files WHERE id = %s", (file_id,))
    delete_document_from_graph(file_id)
    return {"ok": True}

def _chroma_at_str(accessible_to: list[str]) -> str:
    return "|" + "|".join(accessible_to) + "|" if accessible_to else "|"

async def _ingest_file(
    file_bytes: bytes, filename: str, filetype: str,
    user: dict, accessible_to: list[str],
    extract_items: bool = False,
) -> dict:
    extracted = extract_file_text(file_bytes, filetype)
    if not extracted.get("text") or len(extracted["text"].strip()) < 30:
        raise HTTPException(422, "No extractable text found in file")

    raw_chunks = chunk_document(extracted, config["rag"])
    chunks = add_context_prefix(raw_chunks)

    storage_path = f"{uuid.uuid4()}-{re.sub(r'[^\w.\-]+', '_', filename)}"
    file_url = storage_upload(storage_path, file_bytes)

    file_row = execute_returning("""
        INSERT INTO files (filename, filetype, file_url, uploaded_by, accessible_to, version)
        VALUES (%s, %s, %s, %s, %s, 1) RETURNING *
    """, (filename, filetype, file_url, user["name"], accessible_to))

    file_id = file_row["id"]
    at_str = _chroma_at_str(accessible_to)
    col = get_chunks_collection()
    inserted = 0

    for i, chunk in enumerate(chunks):
        enriched = await enrich_chunk(chunk["text"])
        embed_input = build_embedding_input(enriched) or chunk["text"][:2000]
        try:
            embedding = await embed_text(embed_input)
        except Exception:
            continue
        chunk_id = str(uuid.uuid4())
        try:
            execute("""
                INSERT INTO chunks (id, file_id, chunk_text, chunk_summary, keywords, hypothetical_questions, chunk_index)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (chunk_id, file_id, chunk["text"], enriched.get("summary", ""),
                  enriched.get("keywords", []), enriched.get("hypothetical_questions", []), i))
            col.add(
                ids=[chunk_id],
                embeddings=[embedding],
                documents=[chunk["text"]],
                metadatas=[{
                    "file_id": file_id,
                    "chunk_index": i,
                    "chunk_summary": enriched.get("summary", ""),
                    "keywords_json": json.dumps(enriched.get("keywords", [])),
                    "hypothetical_questions_json": json.dumps(enriched.get("hypothetical_questions", [])),
                    "filename": filename,
                    "filetype": filetype,
                    "file_url": file_url,
                    "uploaded_by": user["name"],
                    "accessible_to_str": at_str,
                }],
            )
            inserted += 1
        except Exception:
            pass

    pending_items = None
    if extract_items and filetype.lower() not in ("xlsx", "pptx"):
        items = await extract_action_items(extracted["text"])
        if items:
            pending_items = {
                "source_type": "file", "source_id": file_id, "filename": filename,
                "accessible_to": accessible_to, "items": items,
            }

    if neo4j_ready():
        try:
            entities = await extract_entities(extracted["text"])
            await write_document_to_graph(
                file_id=file_id, filename=filename, filetype=filetype,
                file_url=file_url, uploaded_by=user["name"],
                part=accessible_to[0] if accessible_to else None,
                entities=entities,
            )
            print(f"[graph] indexed {filename}: topics={entities.get('topics',[])} projects={entities.get('projects',[])} people={entities.get('people',[])}")
        except Exception as e:
            print(f"[graph] index failed: {e}")

    return {"file": file_row, "chunk_count": inserted, "pending_action_items": pending_items}

@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    accessible_to: str = Form(default="[]"),
    extract_action_items: str = Form(default="false"),
):
    _ok()
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    file_bytes = await file.read()
    filetype = Path(file.filename or '').suffix.lstrip('.').lower() or (file.content_type or '').split('/')[-1]
    try:
        at = json.loads(accessible_to)
    except Exception:
        at = []
    if not at:
        scope = user.get("part") or user.get("team")
        at = [scope] if scope else []
    return await _ingest_file(
        file_bytes, file.filename or "upload", filetype, user, at,
        extract_items=extract_action_items.lower() == "true",
    )

@app.post("/api/files/{file_id}/replace")
async def replace_file(file_id: str, file: UploadFile = File(...), user_id: str = Form(...)):
    _ok()
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    existing = fetch_one("SELECT * FROM files WHERE id = %s", (file_id,))
    if not existing:
        raise HTTPException(404, "file not found")
    if existing.get("locked_by_id") and existing["locked_by_id"] != user_id and user.get("role") != "MD":
        raise HTTPException(403, f"Locked by {existing.get('locked_by_name', 'another user')}")

    file_bytes = await file.read()
    filetype = Path(file.filename or '').suffix.lstrip('.').lower() or (file.content_type or '').split('/')[-1]
    extracted = extract_file_text(file_bytes, filetype)
    if not extracted.get("text") or len(extracted["text"].strip()) < 30:
        raise HTTPException(422, "No extractable text found in file")

    raw_chunks = chunk_document(extracted, config["rag"])
    chunks = add_context_prefix(raw_chunks)

    storage_path = f"{uuid.uuid4()}-{re.sub(r'[^\w.\-]+', '_', file.filename or 'file')}"
    new_url = storage_upload(storage_path, file_bytes)
    if existing.get("file_url"):
        storage_delete(existing["file_url"])

    col = get_chunks_collection()
    old = col.get(where={"file_id": {"$eq": file_id}})
    if old["ids"]:
        col.delete(ids=old["ids"])
    execute("DELETE FROM chunks WHERE file_id = %s", (file_id,))

    updated = execute_returning("""
        UPDATE files SET filename = %s, filetype = %s, file_url = %s,
            version = %s, updated_by = %s, updated_at = %s,
            locked_by_id = NULL, locked_by_name = NULL, locked_at = NULL
        WHERE id = %s RETURNING *
    """, (file.filename, filetype, new_url,
          (existing.get("version") or 1) + 1, user["name"], datetime.utcnow().isoformat(),
          file_id))

    accessible_to = existing.get("accessible_to") or []
    at_str = _chroma_at_str(accessible_to)
    inserted = 0
    for i, chunk in enumerate(chunks):
        enriched = await enrich_chunk(chunk["text"])
        embed_input = build_embedding_input(enriched) or chunk["text"][:2000]
        try:
            embedding = await embed_text(embed_input)
            chunk_id = str(uuid.uuid4())
            execute("""
                INSERT INTO chunks (id, file_id, chunk_text, chunk_summary, keywords, hypothetical_questions, chunk_index)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (chunk_id, file_id, chunk["text"], enriched.get("summary", ""),
                  enriched.get("keywords", []), enriched.get("hypothetical_questions", []), i))
            col.add(
                ids=[chunk_id],
                embeddings=[embedding],
                documents=[chunk["text"]],
                metadatas=[{
                    "file_id": file_id,
                    "chunk_index": i,
                    "chunk_summary": enriched.get("summary", ""),
                    "keywords_json": json.dumps(enriched.get("keywords", [])),
                    "hypothetical_questions_json": json.dumps(enriched.get("hypothetical_questions", [])),
                    "filename": file.filename,
                    "filetype": filetype,
                    "file_url": new_url,
                    "uploaded_by": user["name"],
                    "accessible_to_str": at_str,
                }],
            )
            inserted += 1
        except Exception:
            pass

    return {"success": True, "file": updated, "chunk_count": inserted}

# ─────────────────────────────────────────────────────────────────────────────
# 4. CHAT + RETRIEVAL
# ─────────────────────────────────────────────────────────────────────────────

CHAT_SYSTEM = (
    "You are a knowledge assistant with access to internal documents. "
    "Answer the user's question using only the context provided below. "
    "When context comes from multiple documents, synthesise and compare across them — "
    "do not refuse just because no single passage contains the full answer. "
    "Only say 'I could not find this in the uploaded documents' if the context contains absolutely no relevant information. "
    "Do not use general knowledge.\n\n"
    "Formatting rules:\n"
    "- Use markdown: headers (##), bullet points, and bold text to structure your answer.\n"
    "- Be thorough and elaborative — explain each point with detail from the documents.\n"
    "- For comparison questions, use a clear structure: shared aspects, then differences.\n"
    "- Always end with a '## Sources' section listing the filenames cited."
)

async def _build_context(
    query: str, part_filter: str | None, include_chatroom: bool = False
) -> tuple[str, list, list, str | None]:
    if include_chatroom:
        ctx_text = await _get_chatroom_context(query)
        return ctx_text or "(no chatroom messages found)", [], [], None

    search_type = "vector"
    chunks = []

    if neo4j_ready():
        try:
            route = await route_query(query)
            routed = route.get("search_type", "vector")
            print(f"[graph] router → {routed} | reason: {route.get('reason', '')}")
            if routed == "graph":
                search_type = "graph"
                chunks = await graph_search(route.get("entities", {}), part_filter)
                print(f"[graph] graph_search returned {len(chunks)} chunks")
        except Exception as e:
            print(f"[graph] route/search failed: {e}")

    if not chunks:
        if search_type == "graph":
            print("[graph] graph returned no results, falling back to vector")
        search_type = "vector"
        chunks = await retrieve(query, part_filter)

    if chunks:
        ctx_parts = []
        for c in chunks:
            label = (f"Slide {c['chunk_index'] + 1}" if "pptx" in (c.get("filetype") or "").lower()
                     else f"Chunk {c['chunk_index']}")
            ctx_parts.append(f"[Source: {c['filename']}, {label}]\n{c['chunk_text']}")
        ctx_text = "\n\n".join(ctx_parts)
    else:
        ctx_text = "(no matching context found)"

    sources = [{"filename": c["filename"], "file_url": c.get("file_url"),
                 "chunk_index": c["chunk_index"], "filetype": c.get("filetype")} for c in chunks]
    eval_chunks = [{"chunk_text": c["chunk_text"], "filename": c["filename"]} for c in chunks]
    return ctx_text, sources, eval_chunks, search_type

@app.post("/api/retrieve")
async def api_retrieve(req: Request):
    body = await req.json()
    query = body.get("query")
    if not query:
        raise HTTPException(400, "query is required")
    part_filter = await resolve_part_filter(body.get("user_id"), body.get("part"))
    chunks = await retrieve(query, part_filter)
    return {"chunks": chunks}

@app.post("/api/chat/route")
async def api_chat_route(req: Request):
    body = await req.json()
    if not body.get("query"):
        raise HTTPException(400, "query required")
    if not neo4j_ready():
        return {"search_type": "vector", "reason": "Neo4j not configured"}
    return await route_query(body["query"])

@app.post("/api/chat")
async def api_chat(req: Request):
    body = await req.json()
    query = body.get("query")
    if not query:
        raise HTTPException(400, "query is required")
    part_filter = await resolve_part_filter(body.get("user_id"), body.get("part"))
    ctx_text, sources, eval_chunks, search_type = await _build_context(
        query, part_filter, body.get("include_chatroom", False)
    )
    history = body.get("conversation_history") or []
    messages = [
        *[{"role": m["role"], "content": m["content"]} for m in history],
        {"role": "user", "content": f"--- Context ---\n{ctx_text}\n\n--- Question ---\n{query}"},
    ]
    answer = await generate_chat(system=CHAT_SYSTEM, messages=messages, max_tokens=4096)
    return {"answer": answer, "sources": sources, "eval_chunks": eval_chunks, "search_type": search_type}

@app.post("/api/chat/stream")
async def api_chat_stream(req: Request):
    body = await req.json()
    query = body.get("query")
    if not query:
        raise HTTPException(400, "query is required")

    async def _gen():
        try:
            part_filter = await resolve_part_filter(body.get("user_id"), body.get("part"))
            ctx_text, sources, eval_chunks, search_type = await _build_context(
                query, part_filter, body.get("include_chatroom", False)
            )
            yield _sse("meta", {"sources": sources, "eval_chunks": eval_chunks, "search_type": search_type})
            history = body.get("conversation_history") or []
            messages = [
                *[{"role": m["role"], "content": m["content"]} for m in history],
                {"role": "user", "content": f"--- Context ---\n{ctx_text}\n\n--- Question ---\n{query}"},
            ]
            async for token in generate_chat_stream(system=CHAT_SYSTEM, messages=messages, max_tokens=4096):
                yield _sse("chunk", {"text": token})
            yield _sse("done", {})
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(_gen(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── RAG Evaluation ──────────────────────────────────────────────────────────

async def _judge_relevance(query: str, chunk_text: str) -> bool:
    raw = await generate_text(
        system='Return JSON {"relevant":true} if chunk is useful for the query, else {"relevant":false}.',
        user=f"Query: {query}\nChunk: {chunk_text[:1500]}", json_mode=True, max_tokens=64,
    )
    try:
        return json.loads(strip_json_fences(raw)).get("relevant", False)
    except Exception:
        return False

async def _decompose_claims(answer: str) -> list[str]:
    raw = await generate_text(
        system="Break the answer into individual atomic factual claims. Return a JSON array of strings.",
        user=answer[:3000], json_mode=True, max_tokens=2048,
    )
    try:
        arr = json.loads(strip_json_fences(raw))
        return [str(x) for x in arr] if isinstance(arr, list) else []
    except Exception:
        return []

async def _judge_claims(claims: list[str], context: str) -> list[bool]:
    raw = await generate_text(
        system="Given context and claims, return a JSON bool array — true if supported, false if not.",
        user=f"Context:\n{context[:4000]}\n\nClaims:\n{json.dumps(claims)}", json_mode=True, max_tokens=1024,
    )
    try:
        arr = json.loads(strip_json_fences(raw))
        return [bool(x) for x in arr] if isinstance(arr, list) else [False] * len(claims)
    except Exception:
        return [False] * len(claims)

@app.post("/api/chat/evaluate")
async def chat_evaluate(req: Request):
    body = await req.json()
    query = body.get("query", "")
    answer = body.get("answer", "")
    chunks = body.get("chunks", [])
    if not query or not answer or not chunks:
        raise HTTPException(400, "query, answer, and chunks required")

    flags = await asyncio.gather(*[_judge_relevance(query, c["chunk_text"]) for c in chunks])
    total_relevant = sum(flags)
    relevant_so_far = 0
    sum_pk = 0.0
    for k, v in enumerate(flags):
        vk = 1 if v else 0
        relevant_so_far += vk
        sum_pk += (relevant_so_far / (k + 1)) * vk
    context_precision = sum_pk / total_relevant if total_relevant > 0 else 0.0

    claims = await _decompose_claims(answer)
    faithfulness = 1.0
    if claims:
        ctx_text = "\n\n".join(c["chunk_text"] for c in chunks)
        support = await _judge_claims(claims, ctx_text)
        faithfulness = sum(support) / len(claims)

    response_relevance = 0.0
    try:
        raw = await generate_text(
            system="Generate 3 questions this answer would directly answer. Return JSON array of 3 strings.",
            user=answer[:3000], json_mode=True, max_tokens=512,
        )
        questions = json.loads(strip_json_fences(raw))
        if isinstance(questions, list) and questions:
            embs = await asyncio.gather(embed_text(query), *[embed_text(q) for q in questions[:3]])
            q_emb, *rest = embs
            sims = [cosine_similarity(q_emb, e) for e in rest]
            response_relevance = sum(sims) / len(sims)
    except Exception:
        pass

    metrics = {
        "context_precision": round(context_precision, 3),
        "faithfulness": round(faithfulness, 3),
        "response_relevance": round(response_relevance, 3),
    }
    execute("""
        INSERT INTO rag_evaluations (query, answer, context_precision, faithfulness, response_relevance)
        VALUES (%s, %s, %s, %s, %s)
    """, (query, answer, metrics["context_precision"], metrics["faithfulness"], metrics["response_relevance"]))
    execute("SELECT update_rag_eval_summary(%s, %s, %s)",
            (metrics["context_precision"], metrics["faithfulness"], metrics["response_relevance"]))
    return metrics

@app.get("/api/chat/eval-summary")
async def chat_eval_summary():
    return fetch_one("SELECT * FROM rag_eval_summary WHERE id = 1") or {}

# ─────────────────────────────────────────────────────────────────────────────
# 5. REPORT GENERATOR
# ─────────────────────────────────────────────────────────────────────────────

REPORT_SYSTEM = """You are a report-writing assistant that produces polished, professional HTML reports. You will be given:
1. A TEMPLATE — example structure showing how the user wants reports formatted
2. INPUT DATA — facts, notes, or context the user wants written up

Your job:
- Produce a complete, comprehensive report that follows the template's STRUCTURE, TONE, and FORMATTING (headings, sections, bullet points, table styles).
- Cover ALL input data thoroughly — do not summarise or truncate. Every data point, metric, finding, and detail in the input should appear in the report. Aim for depth and completeness, not brevity.
- Replace the template's example/placeholder content with the user's actual input data.
- Keep the same section ordering and formatting conventions as the template. Add sub-sections or additional rows/items as needed to accommodate all input data.
- Do NOT include <html>, <head>, <body>, or <style> tags — output only the inner content HTML.
- Do not invent facts not present in the input data — if a section can't be filled, write "<p><em>(not provided)</em></p>".

FORMATTING RULES — use inline styles for a polished, Word-ready look:

Headings:
- <h1> for report title: style="font-size:22pt; color:#1a1a2e; border-bottom:2px solid #3b82f6; padding-bottom:6pt; margin-top:20pt; margin-bottom:10pt; text-align:center;"
- <h2> for all sections: style="font-size:16pt; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:4pt; margin-top:16pt; margin-bottom:8pt;"
- <h3> for subsections: style="font-size:13pt; color:#334155; margin-top:12pt; margin-bottom:6pt;"

Table of Contents — if the report has a ToC, render it as a styled list (no colored backgrounds):
<nav style="border:1px solid #e2e8f0; border-radius:6px; padding:14pt 20pt; margin:16pt 0; background-color:#f8fafc;">
  <p style="font-size:13pt; font-weight:bold; color:#1e293b; margin:0 0 10pt 0; border-bottom:1px solid #e2e8f0; padding-bottom:6pt;">Table of Contents</p>
  <ol style="margin:0; padding-left:18pt; color:#334155; font-size:10pt; line-height:2;">
    <li style="margin-bottom:2pt;">Section title</li>
  </ol>
</nav>

Tables — always use full styling:
- <table>: style="width:100%; border-collapse:collapse; margin:10pt 0;"
- <th>: style="background-color:#1e293b; color:#ffffff; padding:8pt 10pt; text-align:left; font-size:10pt; border:1px solid #cbd5e1;"
- <td>: style="padding:7pt 10pt; font-size:10pt; border:1px solid #e2e8f0;"
- Alternate row shading: add style="background-color:#f8fafc;" on even <tr> rows in <tbody>.

Callout boxes — use for executive summaries, key takeaways, or important notes:
- <div style="background-color:#eff6ff; border-left:4px solid #3b82f6; padding:10pt 14pt; margin:10pt 0; border-radius:4px;">

IMPORTANT — No colored highlights on numbers or text:
- Do NOT use colored or highlighted spans for numbers, KPIs, or metrics. Write numbers inline as plain bold text: <strong>42</strong> items delivered.
- Do NOT use colored badge spans for statuses (no green/yellow/red/amber labels). Write statuses as plain text instead, e.g. "On Track", "At Risk", "Delayed".

Lists:
- <ul> and <ol>: style="margin:6pt 0; padding-left:20pt;"
- <li>: style="margin-bottom:4pt; line-height:1.5;"

Paragraphs: style="margin:6pt 0; line-height:1.6;"

Blockquotes: <blockquote style="border-left:3pt solid #94a3b8; padding:6pt 12pt; margin:8pt 0; color:#475569; background-color:#f8fafc;">

Return ONLY the report HTML. No preamble, no commentary, no markdown fences."""

REPORT_SYSTEM_FREE = """You are a report-writing assistant that produces polished, professional HTML reports.
You will be given INPUT DATA — facts, notes, or context the user wants written up.

Your job:
- Design a well-structured, comprehensive report based solely on the input data.
- Choose an appropriate report structure (title, introduction, sections, conclusion) that best presents the information.
- Cover ALL input data thoroughly — do not summarise or truncate. Every data point, metric, finding, and detail should appear in the report.
- Do NOT include <html>, <head>, <body>, or <style> tags — output only the inner content HTML.
- Do not invent facts not present in the input data.

FORMATTING RULES — use inline styles for a polished, print-ready look:

Headings:
- <h1> for report title: style="font-size:22pt; color:#1a1a2e; border-bottom:2px solid #3b82f6; padding-bottom:6pt; margin-top:20pt; margin-bottom:10pt; text-align:center;"
- <h2> for all sections: style="font-size:16pt; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:4pt; margin-top:16pt; margin-bottom:8pt;"
- <h3> for subsections: style="font-size:13pt; color:#334155; margin-top:12pt; margin-bottom:6pt;"

Table of Contents — if the report has a ToC, render it as a styled list:
<nav style="border:1px solid #e2e8f0; border-radius:6px; padding:14pt 20pt; margin:16pt 0; background-color:#f8fafc;">
  <p style="font-size:13pt; font-weight:bold; color:#1e293b; margin:0 0 10pt 0; border-bottom:1px solid #e2e8f0; padding-bottom:6pt;">Table of Contents</p>
  <ol style="margin:0; padding-left:18pt; color:#334155; font-size:10pt; line-height:2;">
    <li style="margin-bottom:2pt;">Section title</li>
  </ol>
</nav>

Tables — always use full styling:
- <table>: style="width:100%; border-collapse:collapse; margin:10pt 0;"
- <th>: style="background-color:#1e293b; color:#ffffff; padding:8pt 10pt; text-align:left; font-size:10pt; border:1px solid #cbd5e1;"
- <td>: style="padding:7pt 10pt; font-size:10pt; border:1px solid #e2e8f0;"
- Alternate row shading: add style="background-color:#f8fafc;" on even <tr> rows in <tbody>.

Callout boxes — use for executive summaries, key takeaways, or important notes:
- <div style="background-color:#eff6ff; border-left:4px solid #3b82f6; padding:10pt 14pt; margin:10pt 0; border-radius:4px;">

IMPORTANT — No colored highlights on numbers or text:
- Do NOT use colored or highlighted spans for numbers, KPIs, or metrics. Write numbers inline as plain bold text: <strong>42</strong> items delivered.
- Do NOT use colored badge spans for statuses (no green/yellow/red/amber labels). Write statuses as plain text instead, e.g. "On Track", "At Risk", "Delayed".

Lists:
- <ul> and <ol>: style="margin:6pt 0; padding-left:20pt;"
- <li>: style="margin-bottom:4pt; line-height:1.5;"

Paragraphs: style="margin:6pt 0; line-height:1.6;"

Blockquotes: <blockquote style="border-left:3pt solid #94a3b8; padding:6pt 12pt; margin:8pt 0; color:#475569; background-color:#f8fafc;">

Return ONLY the report HTML. No preamble, no commentary, no markdown fences."""

REPORT_REVIEW_SYSTEM = """You are a quality reviewer for AI-generated reports. You will be given:
1. ORIGINAL INPUT DATA — the source facts, notes, and context the report was built from
2. GENERATED REPORT — the HTML the AI produced

Review the report and return ONLY a JSON object in this exact shape — no markdown fences, no extra fields:
{"approved": true, "issues": []}

Check for:
- COMPLETENESS: Is every data point, metric, fact, and decision from the input present in the report? Name any missing items specifically.
- ACCURACY: Does the report state anything not found in the input (invented numbers, wrong names, hallucinated facts)?
- EMPTY SECTIONS: Are any sections present but unfilled or near-empty?
- FORMAT FIT: For XLSX target, are tables used for all data? For PDF, is narrative text used appropriately?

If the report is complete and accurate, return {"approved": true, "issues": []}.
If not, return {"approved": false, "issues": ["specific issue 1", "specific issue 2"]}."""


def _output_format_hint(fmt: str) -> str:
    if fmt == "xlsx":
        return "\n\n--- OUTPUT FORMAT ---\nTarget output: Excel (XLSX). Structure the report to maximise tabular data. Use HTML tables for all data, metrics, comparisons, and lists. Keep narrative text concise — prefer structured tables over long prose paragraphs."
    return "\n\n--- OUTPUT FORMAT ---\nTarget output: PDF. Use rich narrative text, headings, and callout boxes where appropriate."


async def _review_report(input_summary: str, report_html: str, output_format: str) -> dict:
    try:
        raw = await generate_text(
            system=REPORT_REVIEW_SYSTEM,
            user=f"--- ORIGINAL INPUT ---\n{input_summary[:32000]}\n\n--- REPORT (HTML) ---\n{report_html}\n\n--- FORMAT ---\n{output_format}",
            json_mode=True, max_tokens=2048,
        )
        parsed = json.loads(strip_json_fences(raw))
        return {"approved": bool(parsed.get("approved")), "issues": parsed.get("issues", [])}
    except Exception:
        return {"approved": True, "issues": []}


async def _run_report_pipeline(report_model: str, output_format: str, system: str, user_msg: str, input_data: str, extra: dict):
    async def _gen():
        try:
            yield _sse("phase", {"phase": "generating"})
            report = await generate_chat(
                system=system,
                messages=[{"role": "user", "content": user_msg}],
                model=report_model if report_model != "gemini" else None,
                max_tokens=16000,
            )
            yield _sse("phase", {"phase": "reviewing"})
            review = await _review_report(input_data, report, output_format)
            if not review["approved"] and review["issues"]:
                yield _sse("phase", {"phase": "revising"})
                issue_block = "\n".join(f"{i+1}. {iss}" for i, iss in enumerate(review["issues"]))
                revised_msg = f"{user_msg}\n\n--- REVIEWER FEEDBACK ---\n{issue_block}\n\nFix ALL issues. Return complete corrected HTML."
                try:
                    report = await generate_chat(
                        system=system,
                        messages=[{"role": "user", "content": revised_msg}],
                        model=report_model if report_model != "gemini" else None,
                        max_tokens=16000,
                    )
                except Exception:
                    pass
            yield _sse("done", {"report": report, **extra})
        except Exception as e:
            yield _sse("error", {"error": str(e)})

    return StreamingResponse(_gen(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/report/generate")
async def report_generate(req: Request):
    body = await req.json()
    input_data = body.get("input_data", "")
    if not input_data.strip():
        raise HTTPException(400, "input_data is required")
    user_msg = f"--- INPUT DATA ---\n{input_data}{_output_format_hint(body.get('output_format', 'pdf'))}"
    return await _run_report_pipeline(
        body.get("report_model", ""), body.get("output_format", "pdf"),
        REPORT_SYSTEM_FREE, user_msg, input_data, {"template_filename": "report"},
    )


@app.post("/api/report/generate-from-files")
async def report_generate_from_files(req: Request):
    body = await req.json()
    file_ids = body.get("file_ids", [])
    if not file_ids:
        raise HTTPException(400, "file_ids required")
    ph = ",".join(["%s"] * len(file_ids))
    files_list = fetch_all(f"SELECT id, filename FROM files WHERE id::text IN ({ph})", file_ids)
    files = {f["id"]: f for f in files_list}
    chunks_list = fetch_all(
        f"SELECT file_id, chunk_index, chunk_text FROM chunks WHERE file_id::text IN ({ph}) ORDER BY chunk_index",
        file_ids)
    by_file: dict = {}
    for c in chunks_list:
        by_file.setdefault(str(c["file_id"]), []).append(c["chunk_text"])
    sections = [f"### Source: {files[fid]['filename']}\n" + "\n\n".join(by_file.get(fid, []))[:60000]
                for fid in file_ids if fid in files and by_file.get(fid)]
    instruction = body.get("instruction", "")
    input_data = "\n\n".join(filter(None, [f"User instruction: {instruction}" if instruction else None,
                                           "Source documents:", *sections]))
    user_msg = f"--- INPUT DATA ---\n{input_data}{_output_format_hint(body.get('output_format', 'pdf'))}"
    used_files = [{"id": fid, "filename": files[fid]["filename"]} for fid in file_ids if fid in files]
    return await _run_report_pipeline(
        body.get("report_model", ""), body.get("output_format", "pdf"),
        REPORT_SYSTEM_FREE, user_msg, input_data,
        {"template_filename": "report", "used_files": used_files},
    )


@app.get("/api/report-templates")
async def list_report_templates():
    rows = fetch_all("SELECT id, filename, filetype, file_url, uploaded_by, uploaded_at FROM report_templates ORDER BY uploaded_at DESC")
    return {"templates": rows}


@app.post("/api/report-templates")
async def upload_report_template(file: UploadFile = File(...), uploaded_by: str = Form(default="Unknown")):
    data = await file.read()
    filetype = Path(file.filename or '').suffix.lstrip('.').lower() or (file.content_type or '').split('/')[-1]
    extracted = extract_file_text(data, filetype)
    storage_path = f"templates/{uuid.uuid4()}-{file.filename}"
    file_url = storage_upload(storage_path, data, file.content_type or "application/octet-stream")
    row = execute_returning("""
        INSERT INTO report_templates (filename, filetype, file_url, template_text, uploaded_by)
        VALUES (%s, %s, %s, %s, %s) RETURNING *
    """, (file.filename, filetype, file_url, extracted.get("text", ""), uploaded_by))
    return {"template": row}


@app.delete("/api/report-templates/{tmpl_id}")
async def delete_report_template(tmpl_id: str):
    r = fetch_one("SELECT file_url FROM report_templates WHERE id = %s", (tmpl_id,))
    if r and r.get("file_url"):
        storage_delete(r["file_url"])
    execute("DELETE FROM report_templates WHERE id = %s", (tmpl_id,))
    return {"ok": True}


@app.post("/api/report-templates/{tmpl_id}/generate")
async def report_from_template(tmpl_id: str, req: Request):
    body = await req.json()
    tmpl = fetch_one("SELECT * FROM report_templates WHERE id = %s", (tmpl_id,))
    if not tmpl:
        raise HTTPException(404, "template not found")
    input_data = body.get("input_data", "")
    user_msg = f"--- TEMPLATE ({tmpl['filename']}) ---\n{tmpl['template_text']}\n\n--- INPUT DATA ---\n{input_data}{_output_format_hint(body.get('output_format', 'pdf'))}"
    return await _run_report_pipeline(
        body.get("report_model", ""), body.get("output_format", "pdf"),
        REPORT_SYSTEM, user_msg, input_data, {"template_filename": tmpl["filename"]},
    )


@app.post("/api/report-templates/{tmpl_id}/generate-from-files")
async def report_from_template_files(tmpl_id: str, req: Request):
    body = await req.json()
    tmpl = fetch_one("SELECT * FROM report_templates WHERE id = %s", (tmpl_id,))
    if not tmpl:
        raise HTTPException(404, "template not found")
    file_ids = body.get("file_ids", [])
    if not file_ids:
        raise HTTPException(400, "file_ids required")
    ph = ",".join(["%s"] * len(file_ids))
    files_list = fetch_all(f"SELECT id, filename FROM files WHERE id::text IN ({ph})", file_ids)
    files = {f["id"]: f for f in files_list}
    chunks_list = fetch_all(
        f"SELECT file_id, chunk_index, chunk_text FROM chunks WHERE file_id::text IN ({ph}) ORDER BY chunk_index",
        file_ids)
    by_file: dict = {}
    for c in chunks_list:
        by_file.setdefault(str(c["file_id"]), []).append(c["chunk_text"])
    sections = [f"### Source: {files[fid]['filename']}\n" + "\n\n".join(by_file.get(fid, []))[:60000]
                for fid in file_ids if fid in files]
    instruction = body.get("instruction", "")
    input_data = "\n\n".join(filter(None, [f"User instruction: {instruction}" if instruction else None, *sections]))
    user_msg = f"--- TEMPLATE ({tmpl['filename']}) ---\n{tmpl['template_text']}\n\n--- INPUT DATA ---\n{input_data}{_output_format_hint(body.get('output_format', 'pdf'))}"
    used_files = [{"id": fid, "filename": files[fid]["filename"]} for fid in file_ids if fid in files]
    return await _run_report_pipeline(
        body.get("report_model", ""), body.get("output_format", "pdf"),
        REPORT_SYSTEM, user_msg, input_data,
        {"template_filename": tmpl["filename"], "used_files": used_files},
    )


@app.post("/api/files/match")
async def files_match(req: Request):
    body = await req.json()
    instruction = body.get("instruction", "")
    user_id = body.get("user_id")
    if not instruction.strip():
        raise HTTPException(400, "instruction is required")
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if is_all:
            files = fetch_all("SELECT id, filename, uploaded_by, accessible_to, uploaded_at FROM files ORDER BY uploaded_at DESC")
        elif scope:
            files = fetch_all(
                "SELECT id, filename, uploaded_by, accessible_to, uploaded_at FROM files WHERE accessible_to @> ARRAY[%s] ORDER BY uploaded_at DESC",
                (scope,))
        else:
            files = []
    else:
        files = fetch_all("SELECT id, filename, uploaded_by, accessible_to, uploaded_at FROM files ORDER BY uploaded_at DESC")
    raw = await generate_text(
        system='Select relevant files. Return ONLY JSON: {"file_ids":["id1"],"rationale":"one sentence"}',
        user=f"Instruction: {instruction}\n\nFiles:\n{json.dumps(files, default=str)}",
        json_mode=True, max_tokens=1024,
    )
    try:
        parsed = json.loads(strip_json_fences(raw))
        matched_ids = set(parsed.get("file_ids", []))
        matched = [f for f in files if str(f["id"]) in matched_ids]
        return {"matched": matched, "all": files, "rationale": parsed.get("rationale", "")}
    except Exception:
        return {"matched": [], "all": files, "rationale": ""}


# ─────────────────────────────────────────────────────────────────────────────
# 5b. REFINE ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

_REFINE_SYSTEM = (
    'You are a writing quality reviewer for professional documents.\n\n'
    'Analyse the document text and identify genuine improvements in these categories:\n'
    '- "spelling": a word that is clearly misspelled\n'
    '- "grammar": a grammatically incorrect phrase or sentence\n'
    '- "paraphrase": a sentence or short paragraph that could be written more clearly, concisely, or professionally\n\n'
    'Return a JSON array (no wrapping object) of suggestions:\n'
    '[{"type":"spelling"|"grammar"|"paraphrase","original":"exact original segment (max 220 chars)","suggestion":"corrected or improved version","explanation":"one short sentence"}]\n\n'
    'Rules:\n'
    '- Only flag real issues — do not nitpick style preferences\n'
    '- For spelling/grammar the "original" must appear verbatim in the source text\n'
    '- Return at most 10 suggestions; if the text is clean return []\n'
    '- Return ONLY the JSON array, nothing else'
)

_VALID_REFINE_TYPES = {"spelling", "grammar", "paraphrase"}


@app.post("/api/refine")
async def api_refine(req: Request):
    body = await req.json()
    file_id = body.get("file_id")
    if not file_id:
        raise HTTPException(400, "file_id required")
    chunks = fetch_all(
        "SELECT chunk_text, chunk_index FROM chunks WHERE file_id = %s ORDER BY chunk_index",
        (file_id,)
    )
    if not chunks:
        return {"suggestions": [], "text": ""}
    text = "\n\n".join(c["chunk_text"] for c in chunks)[:7000]
    raw = await generate_text(
        system=_REFINE_SYSTEM,
        user=f"Analyse this document:\n\n{text}",
        json_mode=True,
        max_tokens=3000,
    )
    from lib.rag import strip_json_fences
    cleaned = strip_json_fences(raw)
    suggestions = []
    try:
        parsed = json.loads(cleaned)
        suggestions = parsed if isinstance(parsed, list) else parsed.get("suggestions", [])
    except Exception:
        import re as _re
        m = _re.search(r'\[[\s\S]*\]', cleaned)
        if m:
            try:
                suggestions = json.loads(m.group())
            except Exception:
                pass
    suggestions = [
        s for s in suggestions
        if isinstance(s, dict) and s.get("type") in _VALID_REFINE_TYPES
        and s.get("original") and s.get("suggestion")
    ][:10]
    return {"suggestions": suggestions, "text": text}


@app.post("/api/refine/{file_id}/save")
async def api_refine_save(file_id: str, req: Request):
    body = await req.json()
    edited_text = body.get("edited_text", "")
    user_id = body.get("user_id", "")
    if not edited_text or not user_id:
        raise HTTPException(400, "edited_text and user_id required")
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    existing = fetch_one("SELECT * FROM files WHERE id = %s", (file_id,))
    if not existing:
        raise HTTPException(404, "file not found")
    if existing.get("locked_by_id") and existing["locked_by_id"] != user_id and user.get("role") != "MD":
        raise HTTPException(403, f"Locked by {existing.get('locked_by_name') or 'another user'}")

    # Preserve original file format where possible
    orig_ext = Path(existing["filename"]).suffix.lstrip(".").lower()
    if orig_ext == "docx":
        from docx import Document as DocxDocument
        import tempfile
        doc = DocxDocument()
        for line in edited_text.split("\n"):
            doc.add_paragraph(line)
        tmp_fd, tmp_name = tempfile.mkstemp(suffix=".docx")
        os.close(tmp_fd)  # release the fd so python-docx can open the file (Windows requirement)
        doc.save(tmp_name)
        file_bytes = Path(tmp_name).read_bytes()
        Path(tmp_name).unlink(missing_ok=True)
        save_ext = "docx"
    elif orig_ext in ("txt", "md"):
        file_bytes = edited_text.encode("utf-8")
        save_ext = orig_ext
    else:
        # PDF and others can't be reconstructed — save as txt
        file_bytes = edited_text.encode("utf-8")
        save_ext = "txt"

    new_filename = Path(existing["filename"]).stem + f".{save_ext}"
    storage_path = f"{uuid.uuid4()}-{new_filename}"
    new_url = storage_upload(storage_path, file_bytes)

    # Delete old file (best effort)
    if existing.get("file_url"):
        old_name = existing["file_url"].split("/uploads/")[-1]
        old_path = _LOCAL_UPLOADS_DIR / old_name
        if old_path.exists():
            old_path.unlink(missing_ok=True)

    # Clear old chunks from PostgreSQL and ChromaDB
    col = get_chunks_collection()
    existing_ids = col.get(where={"file_id": {"$eq": file_id}})
    if existing_ids["ids"]:
        col.delete(ids=existing_ids["ids"])
    execute("DELETE FROM chunks WHERE file_id = %s", (file_id,))

    # Update files row
    new_version = (existing.get("version") or 1) + 1
    execute("""
        UPDATE files SET filename=%s, filetype=%s, file_url=%s,
        version=%s, updated_by=%s, updated_at=now(),
        locked_by_id=NULL, locked_by_name=NULL, locked_at=NULL
        WHERE id=%s
    """, (new_filename, save_ext, new_url, new_version, user["name"], file_id))

    # Re-chunk and re-ingest
    from lib.chunk import chunk_document
    raw_chunks = chunk_document({"text": edited_text, "kind": "txt"}, config["rag"])
    inserted = 0
    for i, c in enumerate(raw_chunks):
        try:
            enriched = await enrich_chunk(c["text"])
        except Exception:
            enriched = {"summary": "", "keywords": [], "hypothetical_questions": []}
        embed_input = build_embedding_input(enriched) or c["text"][:2000]
        try:
            embedding = await embed_text(embed_input)
        except Exception:
            continue
        chunk_id = str(uuid.uuid4())
        execute("""
            INSERT INTO chunks (id, file_id, chunk_text, chunk_summary, keywords, hypothetical_questions, chunk_index)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, (chunk_id, file_id, c["text"], enriched.get("summary",""),
              enriched.get("keywords",[]), enriched.get("hypothetical_questions",[]), i))
        col.add(
            ids=[chunk_id], embeddings=[embedding], documents=[c["text"]],
            metadatas=[{
                "file_id": file_id, "chunk_index": i,
                "chunk_summary": enriched.get("summary",""),
                "keywords_json": json.dumps(enriched.get("keywords",[])),
                "hypothetical_questions_json": json.dumps(enriched.get("hypothetical_questions",[])),
                "filename": new_filename, "filetype": "txt",
                "file_url": new_url, "uploaded_by": user["name"],
                "accessible_to_str": "|" + "|".join(existing.get("accessible_to") or []) + "|",
            }],
        )
        inserted += 1

    updated = fetch_one("SELECT * FROM files WHERE id = %s", (file_id,))
    return {"success": True, "file": updated, "chunk_count": inserted}


# ─────────────────────────────────────────────────────────────────────────────
# 6. RENDER ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/render-pdf")
async def api_render_pdf(req: Request):
    body = await req.json()
    data = render_pdf(body.get("html", ""))
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf",
                              headers={"Content-Disposition": f'attachment; filename="{body.get("filename","report.pdf")}"'})

@app.post("/api/render-docx")
async def api_render_docx(req: Request):
    body = await req.json()
    data = render_docx(body.get("html", ""))
    return StreamingResponse(io.BytesIO(data),
                              media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                              headers={"Content-Disposition": f'attachment; filename="{body.get("filename","report.docx")}"'})

@app.post("/api/render-xlsx")
async def api_render_xlsx(req: Request):
    body = await req.json()
    data = render_xlsx(body.get("html", body.get("content", "")))
    return StreamingResponse(io.BytesIO(data),
                              media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                              headers={"Content-Disposition": f'attachment; filename="{body.get("filename","report.xlsx")}"'})

# ─────────────────────────────────────────────────────────────────────────────
# 7. MINUTES OF MEETING
# ─────────────────────────────────────────────────────────────────────────────

MOM_PARSE_SYSTEM = (
    'Parse the meeting transcript and return ONLY valid JSON:\n'
    '{"title":"","summary":"","attendees":[],"decisions":[],"action_items":[{"text":"","assignee":"","due":""}]}'
)

@app.post("/api/minutes/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    import tempfile
    from faster_whisper import WhisperModel
    suffix = Path(audio.filename).suffix if audio.filename else ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name
    try:
        model = WhisperModel("base", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(tmp_path)
        transcript = " ".join(seg.text.strip() for seg in segments)
        return {"transcript": transcript}
    finally:
        Path(tmp_path).unlink(missing_ok=True)

@app.post("/api/minutes/parse")
async def parse_transcript(req: Request):
    body = await req.json()
    transcript = body.get("transcript", "")
    if not transcript.strip():
        raise HTTPException(400, "transcript required")
    raw = await generate_text(
        system=MOM_PARSE_SYSTEM,
        user=f"Today's date: {date.today().isoformat()}\n\nTranscript:\n\n{transcript[:20000]}",
        json_mode=True, max_tokens=2048,
    )
    minutes = json.loads(strip_json_fences(raw))
    return {"minutes": minutes}

@app.get("/api/minutes")
async def list_minutes(user_id: str | None = None):
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        if user.get("role") == "MD":
            rows = fetch_all("SELECT * FROM minutes ORDER BY created_at DESC")
        else:
            scope = user.get("part") or user.get("team")
            if not scope:
                return {"minutes": []}
            rows = fetch_all(
                "SELECT * FROM minutes WHERE created_by = %s OR accessible_to @> ARRAY[%s] ORDER BY created_at DESC",
                (user["id"], scope))
    else:
        rows = fetch_all("SELECT * FROM minutes ORDER BY created_at DESC")
    return {"minutes": rows}

@app.post("/api/minutes")
async def save_minutes(req: Request):
    body = await req.json()
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id required")
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    fallback_scope = user.get("part") or user.get("team")
    access_list = body.get("accessible_to") or ([fallback_scope] if fallback_scope else [])
    row = execute_returning("""
        INSERT INTO minutes (title, summary, attendees, decisions, action_items, transcript, created_by, accessible_to)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
    """, (body.get("title"), body.get("summary", ""),
          Json(body.get("attendees", [])), Json(body.get("decisions", [])),
          Json(body.get("action_items", [])), body.get("transcript", ""),
          user_id, access_list))
    return JSONResponse(row, status_code=201)

@app.delete("/api/minutes/{minute_id}")
async def delete_minutes(minute_id: str, user_id: str | None = None):
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "valid user_id required")
    minute = fetch_one("SELECT * FROM minutes WHERE id = %s", (minute_id,))
    if not minute:
        raise HTTPException(404, "not found")
    if user.get("role") != "MD" and minute.get("created_by") != user["id"]:
        raise HTTPException(403, "only creator or MD can delete")
    execute("DELETE FROM minutes WHERE id = %s", (minute_id,))
    return {"ok": True}

@app.post("/api/minutes/{minute_id}/extract-action-items")
async def minutes_extract_actions(minute_id: str, req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user:
        raise HTTPException(400, "valid user_id required")
    minute = fetch_one("SELECT * FROM minutes WHERE id = %s", (minute_id,))
    if not minute:
        raise HTTPException(404, "not found")
    items = [{"id": str(uuid.uuid4()), "text": a.get("text", "") + (f" (mentioned: {a['assignee']})" if a.get("assignee") else ""), "completed": False, "assignees": []}
             for a in (minute.get("action_items") or [])]
    return {"source_type": "mom", "source_id": minute_id,
            "filename": f"MoM: {minute['title']}", "accessible_to": minute.get("accessible_to", []), "items": items}

@app.post("/api/minutes/{minute_id}/save-to-hub")
async def minutes_save_to_hub(minute_id: str, req: Request):
    _ok()
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user:
        raise HTTPException(400, "valid user_id required")
    minute = fetch_one("SELECT * FROM minutes WHERE id = %s", (minute_id,))
    if not minute:
        raise HTTPException(404, "not found")
    lines = [f"# {minute.get('title', 'Meeting Minutes')}"]
    if minute.get("summary"):
        lines += ["", "## Summary", minute["summary"]]
    if minute.get("attendees"):
        lines += ["", f"**Attendees:** {', '.join(minute['attendees'])}"]
    if minute.get("decisions"):
        lines += ["", "## Decisions"] + [f"- {d}" for d in minute["decisions"]]
    if minute.get("action_items"):
        lines += ["", "## Action Items"] + [f"- {a.get('text','')} ({a.get('assignee','')})" for a in minute["action_items"]]
    if minute.get("transcript"):
        lines += ["", "## Transcript", minute["transcript"]]
    md_text = "\n".join(lines)
    result = await _ingest_file(md_text.encode("utf-8"), f"MoM - {minute.get('title', minute_id)}.md",
                                "text/markdown md", user, minute.get("accessible_to", []))
    return result

# ─────────────────────────────────────────────────────────────────────────────
# 8. TASK FORCES
# ─────────────────────────────────────────────────────────────────────────────

def _can_see_all_tfs(user: dict) -> bool:
    return user.get("role") == "MD" or (user.get("role") == "PartHead" and user.get("part") == "Tech Management")

def _can_see_tf(user: dict, tf: dict) -> bool:
    if _can_see_all_tfs(user):
        return True
    return user["id"] in (tf.get("owners") or []) or user["id"] in (tf.get("members") or [])

@app.get("/api/task-forces")
async def list_task_forces(user_id: str | None = None):
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "valid user_id required")
    all_tfs = fetch_all("SELECT * FROM task_forces")
    return {"task_forces": [tf for tf in all_tfs if _can_see_tf(user, tf)]}

@app.post("/api/task-forces")
async def create_task_force(req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user or user.get("role") not in ("MD", "PartHead", "TeamHead"):
        raise HTTPException(403, "insufficient permissions")
    parts = body.get("parts", [])
    teams = body.get("teams", [])
    owner_ids = set(body.get("owners", []))
    owner_ids.add(user["id"])
    if parts:
        ph = ",".join(["%s"] * len(parts))
        heads = fetch_all(f"SELECT id FROM users WHERE role = 'PartHead' AND part IN ({ph})", parts)
        for h in heads:
            owner_ids.add(h["id"])
    if teams:
        ph = ",".join(["%s"] * len(teams))
        heads = fetch_all(f"SELECT id FROM users WHERE role = 'TeamHead' AND team IN ({ph})", teams)
        for h in heads:
            owner_ids.add(h["id"])
    row = execute_returning("""
        INSERT INTO task_forces (name, status, parts, teams, owners, members, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *
    """, (body.get("name"), body.get("status", "Active"),
          parts, teams, list(owner_ids), body.get("members", []), user["id"]))
    return JSONResponse({"task_force": row}, status_code=201)

_TF_SAFE_COLS = {"name", "status", "parts", "teams", "owners", "members"}

@app.patch("/api/task-forces/{tf_id}")
async def update_task_force(tf_id: str, req: Request):
    body = await req.json()
    updates = {k: v for k, v in body.items() if k in _TF_SAFE_COLS}
    if not updates:
        raise HTTPException(400, "no valid fields to update")
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_parts = ", ".join(f"{k} = %s" for k in updates)
    row = execute_returning(f"UPDATE task_forces SET {set_parts} WHERE id = %s RETURNING *",
                            list(updates.values()) + [tf_id])
    return {"task_force": row}

@app.delete("/api/task-forces/{tf_id}")
async def delete_task_force(tf_id: str):
    execute("DELETE FROM task_forces WHERE id = %s", (tf_id,))
    return {"ok": True}

@app.post("/api/task-forces/{tf_id}/updates")
async def add_tf_update(tf_id: str, req: Request):
    body = await req.json()
    row = execute_returning("""
        INSERT INTO tf_updates (tf_id, type, author, content) VALUES (%s, %s, %s, %s) RETURNING *
    """, (tf_id, body.get("type"), body.get("author"), body.get("content")))
    return JSONResponse({"update": row}, status_code=201)

@app.post("/api/task-forces/{tf_id}/action-items")
async def add_tf_action_item(tf_id: str, req: Request):
    body = await req.json()
    row = execute_returning("""
        INSERT INTO tf_action_items (tf_id, text, assignee, due, done) VALUES (%s, %s, %s, %s, false) RETURNING *
    """, (tf_id, body.get("text"), body.get("assignee"), body.get("due")))
    return JSONResponse({"action_item": row}, status_code=201)

_TF_AI_SAFE_COLS = {"text", "assignee", "due", "done"}

@app.patch("/api/task-forces/{tf_id}/action-items/{aid}")
async def update_tf_action_item(tf_id: str, aid: str, req: Request):
    body = await req.json()
    updates = {k: v for k, v in body.items() if k in _TF_AI_SAFE_COLS}
    if not updates:
        raise HTTPException(400, "no valid fields to update")
    set_parts = ", ".join(f"{k} = %s" for k in updates)
    row = execute_returning(f"UPDATE tf_action_items SET {set_parts} WHERE id = %s RETURNING *",
                            list(updates.values()) + [aid])
    return {"action_item": row}

# ─────────────────────────────────────────────────────────────────────────────
# 9. QUIZ
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/quiz/leaderboard")
async def quiz_leaderboard():
    rows = fetch_all("SELECT * FROM quiz_scores ORDER BY score DESC, attempted_at ASC")
    for r in rows:
        if hasattr(r.get("attempted_at"), "isoformat"):
            r["attempted_at"] = r["attempted_at"].isoformat()
    return {"scores": rows}

@app.post("/api/quiz/score")
async def save_quiz_score(req: Request):
    body = await req.json()
    user_id = body.get("user_id")
    score_val = body.get("score")
    if not user_id or not isinstance(score_val, int):
        raise HTTPException(400, "user_id and numeric score are required")
    user = fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))
    if not user:
        raise HTTPException(400, "unknown user")
    row = execute_returning("""
        INSERT INTO quiz_scores (user_id, user_name, quiz_id, score, total, attempted_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (user_id) DO UPDATE SET
            user_name = EXCLUDED.user_name, quiz_id = EXCLUDED.quiz_id,
            score = EXCLUDED.score, total = EXCLUDED.total, attempted_at = EXCLUDED.attempted_at
        RETURNING *
    """, (user_id, user.get("name"), body.get("quiz_id", "rag-basics"),
          score_val, body.get("total", 5), datetime.utcnow().isoformat()))
    if row and hasattr(row.get("attempted_at"), "isoformat"):
        row["attempted_at"] = row["attempted_at"].isoformat()
    return {"score": row}

# ─────────────────────────────────────────────────────────────────────────────
# 10. EMAIL (Gmail OAuth)
# ─────────────────────────────────────────────────────────────────────────────

def _make_oauth_client():
    from google_auth_oauthlib.flow import Flow
    return Flow.from_client_config(
        {"web": {
            "client_id": os.environ["GMAIL_CLIENT_ID"],
            "client_secret": os.environ["GMAIL_CLIENT_SECRET"],
            "redirect_uris": [os.getenv("GMAIL_REDIRECT_URI", "http://localhost:10000/api/email/callback")],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }},
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
        redirect_uri=os.getenv("GMAIL_REDIRECT_URI", "http://localhost:10000/api/email/callback"),
    )

async def _get_gmail_tokens() -> dict | None:
    row = fetch_one("SELECT tokens FROM email_tokens WHERE key = 'gmail'")
    return row["tokens"] if row else None

async def _get_authed_gmail():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    tokens = await _get_gmail_tokens()
    if not tokens:
        return None
    creds = Credentials(
        token=tokens.get("access_token"),
        refresh_token=tokens.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.getenv("GMAIL_CLIENT_ID"),
        client_secret=os.getenv("GMAIL_CLIENT_SECRET"),
    )
    return build("gmail", "v1", credentials=creds)

@app.get("/api/email/status")
async def email_status():
    tokens = await _get_gmail_tokens()
    return {"connected": bool(tokens and tokens.get("refresh_token"))}

@app.get("/api/email/auth")
def email_auth():
    if not os.getenv("GMAIL_CLIENT_ID"):
        raise HTTPException(503, "Gmail OAuth credentials not configured")
    flow = _make_oauth_client()
    url, _ = flow.authorization_url(access_type="offline", prompt="consent")
    return RedirectResponse(url)

@app.get("/api/email/callback")
async def email_callback(code: str):
    flow = _make_oauth_client()
    flow.fetch_token(code=code)
    tokens = {
        "access_token": flow.credentials.token,
        "refresh_token": flow.credentials.refresh_token,
        "expiry": flow.credentials.expiry.isoformat() if flow.credentials.expiry else None,
    }
    execute("""
        INSERT INTO email_tokens (key, tokens, updated_at) VALUES ('gmail', %s, %s)
        ON CONFLICT (key) DO UPDATE SET tokens = EXCLUDED.tokens, updated_at = EXCLUDED.updated_at
    """, (Json(tokens), datetime.utcnow().isoformat()))
    app_url = os.getenv("APP_URL", "http://localhost:5173")
    return RedirectResponse(f"{app_url}/?gmail=connected")

@app.get("/api/email/messages")
async def email_messages(max: int = 20):
    gmail = await _get_authed_gmail()
    if not gmail:
        raise HTTPException(401, "Gmail not connected")
    max = min(max, 50)
    list_r = gmail.users().messages().list(userId="me", labelIds=["INBOX"], maxResults=max).execute()
    msgs = list_r.get("messages", [])

    import base64
    def decode_b64(s: str) -> str:
        return base64.urlsafe_b64decode(s + "==").decode("utf-8", errors="replace")

    def parse_payload(payload: dict) -> tuple[str, list]:
        body, attachments = "", []
        def walk(part):
            nonlocal body
            mime = part.get("mimeType", "")
            if mime == "text/plain" and part.get("body", {}).get("data"):
                body += decode_b64(part["body"]["data"])
            elif part.get("body", {}).get("attachmentId") and part.get("filename"):
                attachments.append({"attachmentId": part["body"]["attachmentId"],
                                     "filename": part["filename"], "mimeType": mime})
            for p in part.get("parts", []):
                walk(p)
        walk(payload)
        return body.strip(), attachments

    emails = []
    for m in msgs[:max]:
        try:
            msg = gmail.users().messages().get(userId="me", id=m["id"], format="full").execute()
            headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
            body, attachments = parse_payload(msg.get("payload", {}))
            emails.append({"id": m["id"], "subject": headers.get("subject", "(no subject)"),
                           "from": headers.get("from", ""), "date": headers.get("date", ""),
                           "snippet": msg.get("snippet", ""), "body": body[:4000], "attachments": attachments})
        except Exception:
            pass
    return {"emails": emails}

@app.post("/api/email/summarize")
async def email_summarize(req: Request):
    body = await req.json()
    emails = body.get("emails", [])
    if not emails:
        raise HTTPException(400, "emails array required")
    email_block = "\n\n---\n\n".join(
        f"[Email {i+1}]\nFrom: {e.get('from','')}\nSubject: {e.get('subject','')}\n\n{(e.get('body') or e.get('snippet',''))[:1500]}"
        for i, e in enumerate(emails)
    )
    summary = await generate_text(
        system="Summarise these emails as bullet points (one per email). Mention sender, topic, and any action/deadline. Keep under 120 words.",
        user=f"Summarise {len(emails)} email(s):\n\n{email_block}", max_tokens=512,
    )
    return {"summary": summary.strip()}

@app.post("/api/email/extract-actions")
async def email_extract_actions(req: Request):
    body = await req.json()
    email_body = body.get("body", "")
    if not email_body.strip():
        raise HTTPException(400, "body is required")
    items = await extract_action_items(f"Subject: {body.get('subject','')}\n\n{email_body}")
    return {"items": items}

@app.post("/api/email/upload-attachment")
async def email_upload_attachment(req: Request):
    _ok()
    body = await req.json()
    gmail = await _get_authed_gmail()
    if not gmail:
        raise HTTPException(401, "Gmail not connected")
    user = await load_user(body.get("user_id"))
    if not user:
        raise HTTPException(400, "unknown user")
    att = gmail.users().messages().attachments().get(
        userId="me", messageId=body["messageId"], id=body["attachmentId"]
    ).execute()
    import base64
    file_bytes = base64.urlsafe_b64decode(att["data"] + "==")
    filename = body.get("filename", "attachment")
    filetype = body.get("mimeType", "application/octet-stream")
    scope = user.get("part") or user.get("team")
    return await _ingest_file(file_bytes, filename, filetype, user, [scope] if scope else [])

# ─────────────────────────────────────────────────────────────────────────────
# 11. CHATROOM
# ─────────────────────────────────────────────────────────────────────────────

async def _get_chatroom_context(query: str) -> str | None:
    try:
        embedding = await embed_text(query)
        col = get_chatroom_collection()
        count = col.count()
        if count == 0:
            return None
        n = min(5, count)
        results = col.query(
            query_embeddings=[embedding],
            n_results=n,
            include=["documents", "distances"],
        )
        docs = results["documents"][0] if results["ids"][0] else []
        return "\n\n".join(docs) if docs else None
    except Exception:
        return None

@app.get("/api/chatroom")
async def get_chatroom(user_id: str, with_: str = Query(alias="with")):
    user = await load_user(user_id)
    if not user or not is_exec_user(user):
        raise HTTPException(403, "Access restricted to MD and Part Heads")
    cid = conv_id(user_id, with_)
    msgs = fetch_all("SELECT * FROM chatroom_messages WHERE conversation_id = %s ORDER BY created_at", (cid,))
    return {"messages": msgs, "conversation_id": cid}

@app.post("/api/chatroom")
async def post_chatroom(req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user or not is_exec_user(user):
        raise HTTPException(403, "Access restricted to MD and Part Heads")
    cid = conv_id(body["user_id"], body["recipient_id"])
    row = execute_returning("""
        INSERT INTO chatroom_messages (conversation_id, sender_id, sender_name, content)
        VALUES (%s, %s, %s, %s) RETURNING *
    """, (cid, body["user_id"], user["name"], body["content"].strip()))
    return JSONResponse({"message": row}, status_code=201)

@app.delete("/api/chatroom/{msg_id}")
async def delete_chatroom_message(msg_id: str, req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user or not is_exec_user(user):
        raise HTTPException(403, "Access restricted to MD and Part Heads")
    msg = fetch_one("SELECT sender_id FROM chatroom_messages WHERE id = %s", (msg_id,))
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["sender_id"] != body["user_id"] and user.get("role") != "MD":
        raise HTTPException(403, "You can only delete your own messages")
    execute("DELETE FROM chatroom_messages WHERE id = %s", (msg_id,))
    return {"success": True}

@app.post("/api/admin/chatroom/process-chunks")
async def process_chatroom_chunks(date_str: str = Query(default=None, alias="date")):
    if not date_str:
        from datetime import timedelta
        date_str = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    msgs = fetch_all(
        "SELECT * FROM chatroom_messages WHERE created_at >= %s AND created_at < %s",
        (date_str, date_str + "T23:59:59"))
    if not msgs:
        return {"ok": True, "chunks": 0}

    text = "\n".join(f"{m['sender_name']}: {m['content']}" for m in msgs)
    summary = await generate_text(
        system="Summarise these chatroom messages into key topics discussed.",
        user=text[:8000], max_tokens=512,
    )
    embedding = await embed_text(text[:2000])
    chunk_id = str(uuid.uuid4())
    execute("""
        INSERT INTO chatroom_chunks (id, chunk_text, topic_summary, processed_date)
        VALUES (%s, %s, %s, %s)
    """, (chunk_id, text[:4000], summary, date_str))
    get_chatroom_collection().add(
        ids=[chunk_id],
        embeddings=[embedding],
        documents=[text[:4000]],
        metadatas=[{"topic_summary": summary, "processed_date": date_str}],
    )
    return {"ok": True, "date": date_str, "chunks": 1}

# ─────────────────────────────────────────────────────────────────────────────
# 12. USERS + HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/users")
async def get_users():
    return {"users": fetch_all("SELECT * FROM users ORDER BY role, name")}

@app.get("/api/health")
def health():
    return {"ok": True, "rag": rag_ready(), "backend": "fastapi", "llm": "ollama", "model": OLLAMA_MODEL}

# ─────────────────────────────────────────────────────────────────────────────
# SPA fallback (must be last)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/{path:path}", include_in_schema=False)
async def spa_fallback(path: str):
    index = _DIST / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"error": "Frontend not built. Run: npm run build"}, status_code=404)
