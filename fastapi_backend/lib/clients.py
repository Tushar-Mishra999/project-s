import os
import json
from pathlib import Path
from supabase import create_client, Client
from neo4j import GraphDatabase

# Load shared config from repo root
_config_path = Path(__file__).parent.parent.parent / "config.json"
config: dict = json.loads(_config_path.read_text())

def rag_ready() -> dict:
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY") if not os.getenv(k)]
    return {"ok": len(missing) == 0, "missing": missing}

# ---------- Supabase ----------
_supabase: Client | None = None

def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_KEY"]
        _supabase = create_client(url, key)
    return _supabase

# ---------- Neo4j ----------
_neo4j_driver = None

def _init_neo4j():
    global _neo4j_driver
    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USER", "neo4j")
    pwd = os.getenv("NEO4J_PASSWORD")
    if uri and pwd:
        _neo4j_driver = GraphDatabase.driver(uri, auth=(user, pwd))

_init_neo4j()

def neo4j_ready() -> bool:
    return _neo4j_driver is not None

def run_neo4j(query: str, params: dict | None = None) -> list[dict]:
    if not _neo4j_driver:
        return []
    with _neo4j_driver.session() as session:
        result = session.run(query, params or {})
        return [dict(r) for r in result]
