"""
Backfill existing files into Neo4j graph.

Run from fastapi_backend/ directory:
    python backfill_graph.py

Reads all files + their chunk text from PostgreSQL, extracts entities via LLM,
and writes Document nodes + relationships to Neo4j.
"""
import asyncio
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from lib.db import fetch_all
from lib.clients import neo4j_ready, init_neo4j_constraints
from lib.graph import extract_entities, write_document_to_graph


async def backfill():
    if not neo4j_ready():
        print("ERROR: NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD not set in .env")
        return

    init_neo4j_constraints()

    files = fetch_all("SELECT id, filename, filetype, file_url, uploaded_by, accessible_to FROM files ORDER BY created_at")
    print(f"Found {len(files)} files to index\n")

    for i, f in enumerate(files, 1):
        file_id   = f["id"]
        filename  = f["filename"]

        # Gather all chunk text for this file
        chunks = fetch_all(
            "SELECT chunk_text FROM chunks WHERE file_id = %s ORDER BY chunk_index",
            (file_id,)
        )
        if not chunks:
            print(f"[{i}/{len(files)}] SKIP {filename} — no chunks")
            continue

        full_text = "\n\n".join(c["chunk_text"] for c in chunks)

        print(f"[{i}/{len(files)}] Indexing {filename} ({len(chunks)} chunks)...")
        try:
            entities = await extract_entities(full_text)
            await write_document_to_graph(
                file_id=file_id,
                filename=filename,
                filetype=f["filetype"] or "",
                file_url=f["file_url"] or "",
                uploaded_by=f["uploaded_by"] or "",
                part=(f["accessible_to"] or [None])[0],
                entities=entities,
            )
            print(f"         topics={entities.get('topics', [])} | people={entities.get('people', [])} | projects={entities.get('projects', [])}")
        except Exception as e:
            print(f"         ERROR: {e}")

    print("\nBackfill complete.")


if __name__ == "__main__":
    asyncio.run(backfill())
