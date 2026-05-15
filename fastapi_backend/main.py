"""FastAPI backend — Ollama-based equivalent of server.js."""
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

from lib.clients import get_supabase, rag_ready, neo4j_ready, config, run_neo4j
from lib.llm import generate_text, generate_chat, generate_chat_stream, embed_text, OLLAMA_MODEL
from lib.rag import retrieve, rerank_chunks, enrich_chunk, build_embedding_input, strip_json_fences, cosine_similarity
from lib.extract import extract_text as extract_file_text
from lib.chunk import chunk_document, add_context_prefix
from lib.graph import extract_entities, write_document_to_graph, delete_document_from_graph, route_query, graph_search
from lib.render import render_pdf, render_docx, render_xlsx
from lib.action_items import extract_action_items
from lib.feed import run_feed_pipeline, live_search

app = FastAPI(title="Kernel FastAPI Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Local storage (used when SUPABASE_URL points to localhost / PostgREST) ───
# When running with native PostgreSQL + PostgREST there is no Supabase Storage
# API. Files are saved to a local folder and served via a /uploads route instead.
_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_USE_LOCAL_STORAGE = "localhost" in _SUPABASE_URL or "127.0.0.1" in _SUPABASE_URL
_LOCAL_UPLOADS_DIR = Path(__file__).parent / "uploads"
_PORT = int(os.getenv("PORT", 10000))

if _USE_LOCAL_STORAGE:
    _LOCAL_UPLOADS_DIR.mkdir(exist_ok=True)

def storage_upload(storage_path: str, file_bytes: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload a file and return its public URL. Uses local disk when running with native PostgreSQL."""
    if _USE_LOCAL_STORAGE:
        dest = _LOCAL_UPLOADS_DIR / storage_path.replace("/", "_")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(file_bytes)
        safe_name = storage_path.replace("/", "_")
        return f"http://localhost:{_PORT}/uploads/{safe_name}"
    sb = get_supabase()
    sb.storage.from_("documents").upload(
        path=storage_path,
        file=file_bytes,
        file_options={"content-type": content_type},
    )
    pub = sb.storage.from_("documents").get_public_url(storage_path)
    return pub if isinstance(pub, str) else pub.get("publicUrl", "")

def storage_delete(file_url: str) -> None:
    """Delete a stored file by its public URL. No-ops silently on failure."""
    try:
        if _USE_LOCAL_STORAGE:
            filename = file_url.split("/uploads/")[-1]
            path = _LOCAL_UPLOADS_DIR / filename
            if path.exists():
                path.unlink()
        else:
            path = file_url.split("/documents/")[-1]
            if path:
                get_supabase().storage.from_("documents").remove([path])
    except Exception:
        pass

# ── Static frontend ──────────────────────────────────────────────────────────
_DIST = Path(__file__).parent.parent / "client" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

# Serve locally uploaded files when using native PostgreSQL
if _USE_LOCAL_STORAGE:
    _LOCAL_UPLOADS_DIR.mkdir(exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(_LOCAL_UPLOADS_DIR)), name="uploads")

# ── Helpers ──────────────────────────────────────────────────────────────────

def _ok() -> dict:
    r = rag_ready()
    if not r["ok"]:
        raise HTTPException(503, f"RAG not configured: missing {', '.join(r['missing'])}")
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
    result = get_supabase().table("users").select("*").eq("id", user_id).maybe_single().execute()
    return result.data

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
_memory_action_items: dict = {}

# ── SSE helper ───────────────────────────────────────────────────────────────

def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

# ─────────────────────────────────────────────────────────────────────────────
# 1. FEED
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/feed")
async def get_feed(part: str | None = None):
    sb = get_supabase()
    key = f"part:{part}" if part else "latest"
    if key in _memory_feed_cache:
        return _memory_feed_cache[key]
    try:
        r = sb.table("feed_cache").select("data,generated_at").eq("id", key).maybe_single().execute()
        if r.data:
            return {**r.data["data"], "generatedAt": r.data["generated_at"]}
    except Exception:
        pass
    payload = await run_feed_pipeline(part)
    _memory_feed_cache[key] = payload
    return payload

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
                    get_supabase().table("feed_cache").upsert({
                        "id": key, "data": payload,
                        "generated_at": payload.get("generatedAt"),
                        "updated_at": datetime.utcnow().isoformat(),
                    }).execute()
                except Exception:
                    pass
            finally:
                _pipeline_running.discard(key)
        asyncio.create_task(_run())
    return {"ok": True, "message": "Feed refresh started"}

@app.get("/api/leaderboard")
async def get_leaderboard():
    return {"leaderboard": [], "note": "Leaderboard requires Gemini grounding — not available in Ollama mode"}

@app.post("/api/worklet")
async def generate_worklet(req: Request):
    body = await req.json()
    title = body.get("title", "")
    url = body.get("url", "")
    result = await generate_text(
        system="You are a technical analyst. Write a 130-160 word digest of the article suitable for a briefing note. Be factual and precise.",
        user=f"Title: {title}\nURL: {url}",
        max_tokens=512,
    )
    return {"worklet": result}

@app.post("/api/feed/live-search")
async def feed_live_search(req: Request):
    body = await req.json()
    query = body.get("query", "")
    results = await live_search(query)
    return {"results": results}

# ─────────────────────────────────────────────────────────────────────────────
# 2. ACTION ITEMS
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/action-items/extract/{file_id}")
async def extract_action_items_preview(file_id: str, req: Request):
    _ok()
    body = await req.json()
    sb = get_supabase()
    r = sb.table("files").select("id,filename,accessible_to").eq("id", file_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "file not found")
    chunks_r = sb.table("chunks").select("chunk_text").eq("file_id", file_id).order("chunk_index").execute()
    text = "\n\n".join(c["chunk_text"] for c in (chunks_r.data or []))
    items = await extract_action_items(text)
    return {"source_type": "file", "source_id": file_id, "filename": r.data["filename"],
            "accessible_to": r.data.get("accessible_to", []), "items": items}

@app.post("/api/action-items")
async def save_action_items(req: Request):
    _ok()
    body = await req.json()
    sb = get_supabase()
    r = sb.table("action_items").insert({
        "file_id": body.get("file_id"),
        "filename": body.get("filename"),
        "accessible_to": body.get("accessible_to", []),
        "items": body.get("items", []),
        "assigned_by": body.get("assigned_by"),
        "source_type": body.get("source_type", "file"),
        "source_id": body.get("source_id"),
    }).select().single().execute()
    return {"action_item": r.data}

@app.get("/api/action-items")
async def list_action_items(user_id: str | None = None, part: str | None = None):
    sb = get_supabase()
    q = sb.table("action_items").select("*").order("created_at", desc=True)
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if not is_all and scope:
            q = q.contains("accessible_to", [scope])
        elif not is_all:
            return {"action_items": []}
    elif part:
        q = q.contains("accessible_to", [part])
    r = q.execute()
    return {"action_items": r.data or []}

@app.patch("/api/action-items/{item_id}")
async def update_action_item(item_id: str, req: Request):
    body = await req.json()
    sb = get_supabase()
    r = sb.table("action_items").update(body).eq("id", item_id).select().single().execute()
    return {"action_item": r.data}

@app.delete("/api/action-items/{item_id}")
async def delete_action_item(item_id: str):
    get_supabase().table("action_items").delete().eq("id", item_id).execute()
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
    sb = get_supabase()
    q = sb.table("files").select("*").order("uploaded_at", desc=True)
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if not is_all:
            if not scope:
                return {"files": []}
            q = q.contains("accessible_to", [scope])
    elif part:
        q = q.contains("accessible_to", [part])
    r = q.execute()
    return {"files": r.data or []}

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
    sb = get_supabase()
    r = sb.table("files").select("id,locked_by_id,locked_by_name,locked_at").eq("id", file_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "file not found")
    f = r.data
    if f.get("locked_by_id") and f["locked_by_id"] != user_id:
        raise HTTPException(409, f"Locked by {f.get('locked_by_name', 'another user')}")
    updated = sb.table("files").update({
        "locked_by_id": user_id, "locked_by_name": user["name"],
        "locked_at": datetime.utcnow().isoformat(),
    }).eq("id", file_id).select().single().execute()
    return {"file": updated.data}

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
    sb = get_supabase()
    r = sb.table("files").select("id,locked_by_id").eq("id", file_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "file not found")
    if r.data.get("locked_by_id") and r.data["locked_by_id"] != user_id and user.get("role") != "MD":
        raise HTTPException(403, "only the lock holder or MD can release this lock")
    updated = sb.table("files").update({
        "locked_by_id": None, "locked_by_name": None, "locked_at": None,
    }).eq("id", file_id).select().single().execute()
    return {"file": updated.data}

@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str):
    _ok()
    sb = get_supabase()
    r = sb.table("files").select("id,file_url").eq("id", file_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "file not found")
    if r.data.get("file_url"):
        storage_delete(r.data["file_url"])
    sb.table("files").delete().eq("id", file_id).execute()
    delete_document_from_graph(file_id)
    return {"ok": True}

async def _ingest_file(
    file_bytes: bytes, filename: str, filetype: str,
    user: dict, accessible_to: list[str],
    extract_items: bool = False,
) -> dict:
    sb = get_supabase()
    extracted = extract_file_text(file_bytes, filetype)
    if not extracted.get("text") or len(extracted["text"].strip()) < 30:
        raise HTTPException(422, "No extractable text found in file")

    raw_chunks = chunk_document(extracted, config["rag"])
    chunks = add_context_prefix(raw_chunks)

    storage_path = f"{uuid.uuid4()}-{re.sub(r'[^\\w.\\-]+', '_', filename)}"
    file_url = storage_upload(storage_path, file_bytes)

    file_row = sb.table("files").insert({
        "filename": filename, "filetype": filetype, "file_url": file_url,
        "uploaded_by": user["name"], "accessible_to": accessible_to,
        "version": 1,
    }).select().single().execute().data

    file_id = file_row["id"]

    inserted = 0
    for i, chunk in enumerate(chunks):
        enriched = await enrich_chunk(chunk["text"])
        embed_input = build_embedding_input(enriched) or chunk["text"][:2000]
        try:
            embedding = await embed_text(embed_input)
        except Exception:
            continue
        try:
            sb.table("chunks").insert({
                "file_id": file_id, "chunk_text": chunk["text"],
                "chunk_summary": enriched.get("summary", ""),
                "keywords": enriched.get("keywords", []),
                "hypothetical_questions": enriched.get("hypothetical_questions", []),
                "embedding": embedding, "chunk_index": i,
            }).execute()
            inserted += 1
        except Exception:
            pass

    scope = user.get("part") or user.get("team")
    if neo4j_ready():
        full_text = extracted["text"]
        entities = await extract_entities(full_text[:6000])
        await write_document_to_graph(
            file_id, filename, filetype, file_url, user["name"], scope, entities
        )

    pending_items = None
    if extract_items and filetype.lower() not in ("xlsx", "pptx"):
        items = await extract_action_items(extracted["text"])
        if items:
            pending_items = {
                "source_type": "file", "source_id": file_id, "filename": filename,
                "accessible_to": accessible_to, "items": items,
            }

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
    filetype = f"{file.content_type or ''} {Path(file.filename or '').suffix.lstrip('.').lower()}".strip()

    try:
        at = json.loads(accessible_to)
    except Exception:
        at = []
    if not at:
        scope = user.get("part") or user.get("team")
        at = [scope] if scope else []

    result = await _ingest_file(
        file_bytes, file.filename or "upload", filetype, user, at,
        extract_items=extract_action_items.lower() == "true",
    )
    return result

@app.post("/api/files/{file_id}/replace")
async def replace_file(file_id: str, file: UploadFile = File(...), user_id: str = Form(...)):
    _ok()
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "unknown user")
    sb = get_supabase()
    existing_r = sb.table("files").select("*").eq("id", file_id).maybe_single().execute()
    if not existing_r.data:
        raise HTTPException(404, "file not found")
    existing = existing_r.data
    if existing.get("locked_by_id") and existing["locked_by_id"] != user_id and user.get("role") != "MD":
        raise HTTPException(403, f"Locked by {existing.get('locked_by_name', 'another user')}")

    file_bytes = await file.read()
    filetype = f"{file.content_type or ''} {Path(file.filename or '').suffix.lstrip('.').lower()}".strip()
    extracted = extract_file_text(file_bytes, filetype)
    if not extracted.get("text") or len(extracted["text"].strip()) < 30:
        raise HTTPException(422, "No extractable text found in file")

    raw_chunks = chunk_document(extracted, config["rag"])
    chunks = add_context_prefix(raw_chunks)

    storage_path = f"{uuid.uuid4()}-{re.sub(r'[^\\w.\\-]+', '_', file.filename or 'file')}"
    new_url = storage_upload(storage_path, file_bytes)

    if existing.get("file_url"):
        storage_delete(existing["file_url"])

    sb.table("chunks").delete().eq("file_id", file_id).execute()

    updated = sb.table("files").update({
        "filename": file.filename, "filetype": filetype, "file_url": new_url,
        "version": (existing.get("version") or 1) + 1,
        "updated_by": user["name"], "updated_at": datetime.utcnow().isoformat(),
        "locked_by_id": None, "locked_by_name": None, "locked_at": None,
    }).eq("id", file_id).select().single().execute().data

    inserted = 0
    for i, chunk in enumerate(chunks):
        enriched = await enrich_chunk(chunk["text"])
        embed_input = build_embedding_input(enriched) or chunk["text"][:2000]
        try:
            embedding = await embed_text(embed_input)
            sb.table("chunks").insert({
                "file_id": file_id, "chunk_text": chunk["text"],
                "chunk_summary": enriched.get("summary", ""),
                "keywords": enriched.get("keywords", []),
                "hypothetical_questions": enriched.get("hypothetical_questions", []),
                "embedding": embedding, "chunk_index": i,
            }).execute()
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
    "If the answer is not present in the context, say 'I could not find this in the uploaded documents' "
    "— do not use general knowledge. Always cite the source filename at the end of your answer."
)

async def _build_context(
    query: str, part_filter: str | None, include_chatroom: bool = False
) -> tuple[str, list, list, str | None]:
    if include_chatroom:
        ctx_text = await _get_chatroom_context(query)
        return ctx_text or "(no chatroom messages found)", [], [], None

    route = await route_query(query)
    search_type = route["search_type"]
    chunks: list[dict] = []
    if search_type == "graph" and neo4j_ready():
        chunks = await graph_search(route.get("entities", {}), part_filter)
        if not chunks:
            chunks = await retrieve(query, part_filter)
    else:
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
    query = body.get("query")
    if not query:
        raise HTTPException(400, "query required")
    route = await route_query(query)
    return {"search_type": route["search_type"], "reason": route["reason"]}

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
    sb = get_supabase()
    sb.table("rag_evaluations").insert({**metrics, "query": query, "answer": answer}).execute()
    sb.rpc("update_rag_eval_summary", metrics).execute()
    return metrics

@app.get("/api/chat/eval-summary")
async def chat_eval_summary():
    r = get_supabase().table("rag_eval_summary").select("*").eq("id", 1).maybe_single().execute()
    return r.data or {}

# ─────────────────────────────────────────────────────────────────────────────
# 5. REPORT GENERATOR
# ─────────────────────────────────────────────────────────────────────────────

REPORT_SYSTEM = """You are a report-writing assistant that produces polished, professional HTML reports. You will be given:
1. A TEMPLATE — example structure showing how the user wants reports formatted
2. INPUT DATA — facts, notes, or context the user wants written up

Your job:
- Produce a complete, comprehensive report that follows the template's STRUCTURE, TONE, and FORMATTING.
- Cover ALL input data thoroughly. Do not summarise or truncate.
- Do NOT include <html>, <head>, <body>, or <style> tags — output only inner HTML.
- Do not invent facts not present in the input data.

Use inline styles for polished output. Return ONLY the report HTML."""

REPORT_SYSTEM_FREE = """You are a report-writing assistant that produces polished, professional HTML reports.
Given INPUT DATA, design and write a well-structured report. Cover ALL data thoroughly.
Do NOT include <html>, <head>, <body>, or <style> tags. Do not invent facts.
Return ONLY the report HTML."""

REPORT_REVIEW_SYSTEM = """You are a quality reviewer for AI-generated reports.
Check for: COMPLETENESS (every fact in input appears in report), ACCURACY (no invented content),
EMPTY SECTIONS, FORMAT FIT (XLSX=tables, PDF=narrative).
Return ONLY JSON: {"approved":true,"issues":[]} or {"approved":false,"issues":["issue1"]}."""


def _output_format_hint(fmt: str) -> str:
    if fmt == "xlsx":
        return "\n\n--- OUTPUT FORMAT ---\nTarget: Excel (XLSX). Use HTML tables for all data. Keep prose minimal."
    return "\n\n--- OUTPUT FORMAT ---\nTarget: PDF. Use rich narrative text, headings, and callout boxes."


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
    sb = get_supabase()
    files_r = sb.table("files").select("id,filename").in_("id", file_ids).execute()
    files = {f["id"]: f for f in (files_r.data or [])}
    chunks_r = sb.table("chunks").select("file_id,chunk_index,chunk_text").in_("file_id", file_ids).order("chunk_index").execute()
    by_file: dict = {}
    for c in (chunks_r.data or []):
        by_file.setdefault(c["file_id"], []).append(c["chunk_text"])
    sections = [f"### Source: {files[fid]['filename']}\n" + "\n\n".join(by_file.get(fid, []))[:60000]
                for fid in file_ids if fid in files and by_file.get(fid)]
    instruction = body.get("instruction", "")
    input_data = "\n\n".join(filter(None, [f"User instruction: {instruction}" if instruction else None,
                                           "Source documents:", *[s for s in sections]]))
    user_msg = f"--- INPUT DATA ---\n{input_data}{_output_format_hint(body.get('output_format', 'pdf'))}"
    used_files = [{"id": fid, "filename": files[fid]["filename"]} for fid in file_ids if fid in files]
    return await _run_report_pipeline(
        body.get("report_model", ""), body.get("output_format", "pdf"),
        REPORT_SYSTEM_FREE, user_msg, input_data,
        {"template_filename": "report", "used_files": used_files},
    )


@app.get("/api/report-templates")
async def list_report_templates():
    r = get_supabase().table("report_templates").select("id,filename,filetype,file_url,uploaded_by,uploaded_at").order("uploaded_at", desc=True).execute()
    return {"templates": r.data or []}


@app.post("/api/report-templates")
async def upload_report_template(file: UploadFile = File(...), uploaded_by: str = Form(default="Unknown")):
    sb = get_supabase()
    data = await file.read()
    filetype = f"{file.content_type or ''} {Path(file.filename or '').suffix.lstrip('.').lower()}".strip()
    extracted = extract_file_text(data, filetype)
    storage_path = f"templates/{uuid.uuid4()}-{file.filename}"
    file_url = storage_upload(storage_path, data, file.content_type or "application/octet-stream")
    r = sb.table("report_templates").insert({
        "filename": file.filename, "filetype": filetype, "file_url": file_url,
        "template_text": extracted.get("text", ""), "uploaded_by": uploaded_by,
    }).select().single().execute()
    return {"template": r.data}


@app.delete("/api/report-templates/{tmpl_id}")
async def delete_report_template(tmpl_id: str):
    sb = get_supabase()
    r = sb.table("report_templates").select("file_url").eq("id", tmpl_id).maybe_single().execute()
    if r.data and r.data.get("file_url"):
        storage_delete(r.data["file_url"])
    sb.table("report_templates").delete().eq("id", tmpl_id).execute()
    return {"ok": True}


@app.post("/api/report-templates/{tmpl_id}/generate")
async def report_from_template(tmpl_id: str, req: Request):
    body = await req.json()
    sb = get_supabase()
    tmpl_r = sb.table("report_templates").select("*").eq("id", tmpl_id).maybe_single().execute()
    if not tmpl_r.data:
        raise HTTPException(404, "template not found")
    tmpl = tmpl_r.data
    input_data = body.get("input_data", "")
    user_msg = f"--- TEMPLATE ({tmpl['filename']}) ---\n{tmpl['template_text']}\n\n--- INPUT DATA ---\n{input_data}{_output_format_hint(body.get('output_format', 'pdf'))}"
    return await _run_report_pipeline(
        body.get("report_model", ""), body.get("output_format", "pdf"),
        REPORT_SYSTEM, user_msg, input_data, {"template_filename": tmpl["filename"]},
    )


@app.post("/api/report-templates/{tmpl_id}/generate-from-files")
async def report_from_template_files(tmpl_id: str, req: Request):
    body = await req.json()
    sb = get_supabase()
    tmpl_r = sb.table("report_templates").select("*").eq("id", tmpl_id).maybe_single().execute()
    if not tmpl_r.data:
        raise HTTPException(404, "template not found")
    tmpl = tmpl_r.data
    file_ids = body.get("file_ids", [])
    files_r = sb.table("files").select("id,filename").in_("id", file_ids).execute()
    files = {f["id"]: f for f in (files_r.data or [])}
    chunks_r = sb.table("chunks").select("file_id,chunk_index,chunk_text").in_("file_id", file_ids).order("chunk_index").execute()
    by_file: dict = {}
    for c in (chunks_r.data or []):
        by_file.setdefault(c["file_id"], []).append(c["chunk_text"])
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
    sb = get_supabase()
    q = sb.table("files").select("id,filename,uploaded_by,accessible_to,uploaded_at").order("uploaded_at", desc=True)
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        scope, is_all = user_scope(user)
        if not is_all and scope:
            q = q.contains("accessible_to", [scope])
    r = q.execute()
    files = r.data or []
    raw = await generate_text(
        system='Select relevant files. Return ONLY JSON: {"file_ids":["id1"],"rationale":"one sentence"}',
        user=f"Instruction: {instruction}\n\nFiles:\n{json.dumps(files)}",
        json_mode=True, max_tokens=1024,
    )
    try:
        parsed = json.loads(strip_json_fences(raw))
        matched_ids = set(parsed.get("file_ids", []))
        matched = [f for f in files if f["id"] in matched_ids]
        return {"matched": matched, "all": files, "rationale": parsed.get("rationale", "")}
    except Exception:
        return {"matched": [], "all": files, "rationale": ""}


# ─────────────────────────────────────────────────────────────────────────────
# 6. RENDER ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/render-pdf")
async def api_render_pdf(req: Request):
    body = await req.json()
    html = body.get("html", "")
    filename = body.get("filename", "report.pdf")
    data = render_pdf(html)
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf",
                              headers={"Content-Disposition": f'attachment; filename="{filename}"'})

@app.post("/api/render-docx")
async def api_render_docx(req: Request):
    body = await req.json()
    html = body.get("html", "")
    filename = body.get("filename", "report.docx")
    data = render_docx(html)
    return StreamingResponse(io.BytesIO(data),
                              media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                              headers={"Content-Disposition": f'attachment; filename="{filename}"'})

@app.post("/api/render-xlsx")
async def api_render_xlsx(req: Request):
    body = await req.json()
    html = body.get("html", body.get("content", ""))
    filename = body.get("filename", "report.xlsx")
    data = render_xlsx(html)
    return StreamingResponse(io.BytesIO(data),
                              media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                              headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ─────────────────────────────────────────────────────────────────────────────
# 7. MINUTES OF MEETING
# ─────────────────────────────────────────────────────────────────────────────

MOM_PARSE_SYSTEM = (
    'Parse the meeting transcript and return ONLY valid JSON:\n'
    '{"title":"","summary":"","attendees":[],"decisions":[],"action_items":[{"text":"","assignee":"","due":""}]}'
)

@app.post("/api/minutes/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    import whisper, tempfile, os
    data = await audio.read()
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        model = whisper.load_model("base")
        result = model.transcribe(tmp_path)
        return {"transcript": result.get("text", "")}
    finally:
        os.unlink(tmp_path)

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
    sb = get_supabase()
    q = sb.table("minutes").select("*").order("created_at", desc=True)
    if user_id:
        user = await load_user(user_id)
        if not user:
            raise HTTPException(400, "unknown user")
        if user.get("role") != "MD":
            scope = user.get("part") or user.get("team")
            if not scope:
                return {"minutes": []}
            q = q.or_(f"created_by.eq.{user['id']},accessible_to.cs.{{{scope}}}")
    r = q.execute()
    return {"minutes": r.data or []}

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
    r = get_supabase().table("minutes").insert({
        "title": body.get("title"), "summary": body.get("summary", ""),
        "attendees": body.get("attendees", []), "decisions": body.get("decisions", []),
        "action_items": body.get("action_items", []), "transcript": body.get("transcript", ""),
        "created_by": user_id, "accessible_to": access_list,
    }).select().single().execute()
    return JSONResponse(r.data, status_code=201)

@app.delete("/api/minutes/{minute_id}")
async def delete_minutes(minute_id: str, user_id: str | None = None):
    sb = get_supabase()
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "valid user_id required")
    r = sb.table("minutes").select("*").eq("id", minute_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "not found")
    if user.get("role") != "MD" and r.data.get("created_by") != user["id"]:
        raise HTTPException(403, "only creator or MD can delete")
    sb.table("minutes").delete().eq("id", minute_id).execute()
    return {"ok": True}

@app.post("/api/minutes/{minute_id}/extract-action-items")
async def minutes_extract_actions(minute_id: str, req: Request):
    body = await req.json()
    sb = get_supabase()
    user = await load_user(body.get("user_id"))
    if not user:
        raise HTTPException(400, "valid user_id required")
    r = sb.table("minutes").select("*").eq("id", minute_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "not found")
    minute = r.data
    items = [{"id": str(uuid.uuid4()), "text": a.get("text", "") + (f" (mentioned: {a['assignee']})" if a.get("assignee") else ""), "completed": False, "assignees": []}
             for a in (minute.get("action_items") or [])]
    return {"source_type": "mom", "source_id": minute_id,
            "filename": f"MoM: {minute['title']}", "accessible_to": minute.get("accessible_to", []), "items": items}

@app.post("/api/minutes/{minute_id}/save-to-hub")
async def minutes_save_to_hub(minute_id: str, req: Request):
    _ok()
    body = await req.json()
    sb = get_supabase()
    user = await load_user(body.get("user_id"))
    if not user:
        raise HTTPException(400, "valid user_id required")
    r = sb.table("minutes").select("*").eq("id", minute_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "not found")
    minute = r.data
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
    file_bytes = md_text.encode("utf-8")
    filename = f"MoM - {minute.get('title', minute_id)}.md"
    result = await _ingest_file(file_bytes, filename, "text/markdown md", user, minute.get("accessible_to", []))
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
    sb = get_supabase()
    user = await load_user(user_id)
    if not user:
        raise HTTPException(400, "valid user_id required")
    r = sb.table("task_forces").select("*").execute()
    tfs = [tf for tf in (r.data or []) if _can_see_tf(user, tf)]
    return {"task_forces": tfs}

@app.post("/api/task-forces")
async def create_task_force(req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user or user.get("role") not in ("MD", "PartHead", "TeamHead"):
        raise HTTPException(403, "insufficient permissions")
    sb = get_supabase()
    parts = body.get("parts", [])
    teams = body.get("teams", [])
    owner_ids = set(body.get("owners", []))
    owner_ids.add(user["id"])
    if parts:
        heads = sb.table("users").select("id").eq("role", "PartHead").in_("part", parts).execute()
        for h in (heads.data or []):
            owner_ids.add(h["id"])
    if teams:
        heads = sb.table("users").select("id").eq("role", "TeamHead").in_("team", teams).execute()
        for h in (heads.data or []):
            owner_ids.add(h["id"])
    r = sb.table("task_forces").insert({
        "name": body.get("name"), "status": body.get("status", "Active"),
        "parts": parts, "teams": teams,
        "owners": list(owner_ids), "members": body.get("members", []),
        "created_by": user["id"],
    }).select().single().execute()
    return JSONResponse({"task_force": r.data}, status_code=201)

@app.patch("/api/task-forces/{tf_id}")
async def update_task_force(tf_id: str, req: Request):
    body = await req.json()
    r = get_supabase().table("task_forces").update(body).eq("id", tf_id).select().single().execute()
    return {"task_force": r.data}

@app.delete("/api/task-forces/{tf_id}")
async def delete_task_force(tf_id: str):
    get_supabase().table("task_forces").delete().eq("id", tf_id).execute()
    return {"ok": True}

@app.post("/api/task-forces/{tf_id}/updates")
async def add_tf_update(tf_id: str, req: Request):
    body = await req.json()
    r = get_supabase().table("tf_updates").insert({
        "tf_id": tf_id, "type": body.get("type"), "author": body.get("author"), "content": body.get("content"),
    }).select().single().execute()
    return JSONResponse({"update": r.data}, status_code=201)

@app.post("/api/task-forces/{tf_id}/action-items")
async def add_tf_action_item(tf_id: str, req: Request):
    body = await req.json()
    r = get_supabase().table("tf_action_items").insert({
        "tf_id": tf_id, "text": body.get("text"), "assignee": body.get("assignee"),
        "due": body.get("due"), "done": False,
    }).select().single().execute()
    return JSONResponse({"action_item": r.data}, status_code=201)

@app.patch("/api/task-forces/{tf_id}/action-items/{aid}")
async def update_tf_action_item(tf_id: str, aid: str, req: Request):
    body = await req.json()
    r = get_supabase().table("tf_action_items").update(body).eq("id", aid).select().single().execute()
    return {"action_item": r.data}

# ─────────────────────────────────────────────────────────────────────────────
# 9. QUIZ
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/quiz/leaderboard")
async def quiz_leaderboard():
    r = get_supabase().table("quiz_scores").select("*").order("score", desc=True).order("attempted_at", desc=True).execute()
    return {"leaderboard": r.data or []}

@app.post("/api/quiz/score")
async def save_quiz_score(req: Request):
    body = await req.json()
    r = get_supabase().table("quiz_scores").upsert({
        "user_id": body.get("user_id"), "user_name": body.get("user_name"),
        "quiz_id": body.get("quiz_id", "rag-basics"),
        "score": body.get("score"), "total": body.get("total", 5),
        "attempted_at": datetime.utcnow().isoformat(),
    }).select().single().execute()
    return {"score": r.data}

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
    r = get_supabase().table("email_tokens").select("tokens").eq("key", "gmail").maybe_single().execute()
    return r.data["tokens"] if r.data else None

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
    get_supabase().table("email_tokens").upsert({"key": "gmail", "tokens": tokens, "updated_at": datetime.utcnow().isoformat()}).execute()
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
    result = await _ingest_file(file_bytes, filename, filetype, user, [scope] if scope else [])
    return result

# ─────────────────────────────────────────────────────────────────────────────
# 11. CHATROOM
# ─────────────────────────────────────────────────────────────────────────────

async def _get_chatroom_context(query: str) -> str | None:
    sb = get_supabase()
    try:
        embedding = await embed_text(query)
        r = sb.rpc("match_chatroom_chunks", {"query_embedding": embedding, "match_count": 5}).execute()
        chunks = r.data or []
        if not chunks:
            return None
        return "\n\n".join(c.get("chunk_text", "") for c in chunks)
    except Exception:
        return None

@app.get("/api/chatroom")
async def get_chatroom(user_id: str, with_: str = Query(alias="with")):
    user = await load_user(user_id)
    if not user or not is_exec_user(user):
        raise HTTPException(403, "Access restricted to MD and Part Heads")
    cid = conv_id(user_id, with_)
    r = get_supabase().table("chatroom_messages").select("*").eq("conversation_id", cid).order("created_at").execute()
    return {"messages": r.data or [], "conversation_id": cid}

@app.post("/api/chatroom")
async def post_chatroom(req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user or not is_exec_user(user):
        raise HTTPException(403, "Access restricted to MD and Part Heads")
    cid = conv_id(body["user_id"], body["recipient_id"])
    r = get_supabase().table("chatroom_messages").insert({
        "conversation_id": cid, "sender_id": body["user_id"],
        "sender_name": user["name"], "content": body["content"].strip(),
    }).select().single().execute()
    return JSONResponse({"message": r.data}, status_code=201)

@app.delete("/api/chatroom/{msg_id}")
async def delete_chatroom_message(msg_id: str, req: Request):
    body = await req.json()
    user = await load_user(body.get("user_id"))
    if not user or not is_exec_user(user):
        raise HTTPException(403, "Access restricted to MD and Part Heads")
    sb = get_supabase()
    r = sb.table("chatroom_messages").select("sender_id").eq("id", msg_id).maybe_single().execute()
    if not r.data:
        raise HTTPException(404, "Message not found")
    if r.data["sender_id"] != body["user_id"] and user.get("role") != "MD":
        raise HTTPException(403, "You can only delete your own messages")
    sb.table("chatroom_messages").delete().eq("id", msg_id).execute()
    return {"success": True}

@app.post("/api/admin/chatroom/process-chunks")
async def process_chatroom_chunks(date_str: str = Query(default=None, alias="date")):
    if not date_str:
        from datetime import timedelta
        date_str = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    sb = get_supabase()
    r = sb.table("chatroom_messages").select("*").gte("created_at", date_str).lt("created_at", date_str + "T23:59:59").execute()
    msgs = r.data or []
    if not msgs:
        return {"ok": True, "chunks": 0}

    text = "\n".join(f"{m['sender_name']}: {m['content']}" for m in msgs)
    summary = await generate_text(
        system="Summarise these chatroom messages into key topics discussed.",
        user=text[:8000], max_tokens=512,
    )
    embedding = await embed_text(text[:2000])
    sb.table("chatroom_chunks").insert({
        "chunk_text": text[:4000], "topic_summary": summary,
        "embedding": embedding, "processed_date": date_str,
    }).execute()
    return {"ok": True, "date": date_str, "chunks": 1}

# ─────────────────────────────────────────────────────────────────────────────
# 12. USERS + HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/users")
async def get_users():
    r = get_supabase().table("users").select("*").order("role").order("name").execute()
    return {"users": r.data or []}

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
