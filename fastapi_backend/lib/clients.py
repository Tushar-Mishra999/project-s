from __future__ import annotations

import os
import json
from pathlib import Path
import chromadb
from neo4j import GraphDatabase

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


# ---------- Neo4j ----------
_neo4j_driver = None


def neo4j_ready() -> bool:
    return bool(os.getenv("NEO4J_URI") and os.getenv("NEO4J_USER") and os.getenv("NEO4J_PASSWORD"))


def _get_neo4j_driver():
    global _neo4j_driver
    if _neo4j_driver is None and neo4j_ready():
        _neo4j_driver = GraphDatabase.driver(
            os.environ["NEO4J_URI"],
            auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]),
            max_connection_pool_size=10,
        )
    return _neo4j_driver


def run_neo4j(cypher: str, params: dict | None = None) -> list[dict]:
    driver = _get_neo4j_driver()
    if not driver:
        raise RuntimeError("Neo4j not configured")
    with driver.session() as session:
        result = session.run(cypher, params or {})
        return [dict(r) for r in result]


def init_neo4j_constraints() -> None:
    if not neo4j_ready():
        return
    constraints = [
        "CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
        "CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE",
        "CREATE CONSTRAINT tech_name IF NOT EXISTS FOR (t:Technology) REQUIRE t.name IS UNIQUE",
        "CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE",
        "CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE",
    ]
    for c in constraints:
        try:
            run_neo4j(c)
        except Exception as e:
            print(f"[neo4j] constraint warning: {e}")
    print("[neo4j] constraints initialised")
