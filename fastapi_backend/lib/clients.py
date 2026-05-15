from __future__ import annotations

import os
import json
from pathlib import Path
import chromadb

_config_path = Path(__file__).parent.parent.parent / "config.json"
config: dict = json.loads(_config_path.read_text())


def rag_ready() -> dict:
    try:
        from .db import fetch_one
        fetch_one("SELECT 1")
        return {"ok": True, "missing": []}
    except Exception as e:
        return {"ok": False, "missing": [f"DB connection failed: {e}"]}


# ---------- ChromaDB ----------
_chroma_client: chromadb.PersistentClient | None = None


def get_chroma() -> chromadb.PersistentClient:
    global _chroma_client
    if _chroma_client is None:
        chroma_dir = os.getenv("CHROMA_DIR", str(Path(__file__).parent.parent / "chroma_data"))
        _chroma_client = chromadb.PersistentClient(path=chroma_dir)
    return _chroma_client


def get_chunks_collection():
    return get_chroma().get_or_create_collection("chunks", metadata={"hnsw:space": "cosine"})


def get_chatroom_collection():
    return get_chroma().get_or_create_collection("chatroom_chunks", metadata={"hnsw:space": "cosine"})
