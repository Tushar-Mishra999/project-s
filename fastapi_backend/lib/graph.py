"""Neo4j graph operations and query routing — mirrors lib/graphExtract.js."""
import json
from .llm import generate_text
from .clients import neo4j_ready, run_neo4j, config
from .db import fetch_all
from .rag import strip_json_fences

_ENTITY_SYSTEM = (
    'Extract entities from the following document text and return ONLY a JSON object:\n'
    '{"topics":[],"technologies":[],"people":[],"projects":[],"decisions":[]}\n'
    'Keep each list concise (max 10 items each). Return only valid JSON.'
)

_ROUTE_SYSTEM = """You are a search router for a knowledge management system.

Use "graph" when the query:
- Asks about everything related to a topic, technology, or person across documents
- Needs to connect information from multiple sources
- Uses phrases like "all documents about", "everything related to", "what do we know about", "across our knowledge base"
- Asks about relationships between entities or who is involved in what

Use "vector" when the query:
- Asks about specific content likely found in one passage
- Is a focused factual or summary question about a single topic
- Asks to explain or describe something specific

Also extract the key named entities from the query.

Return only valid JSON:
{
  "search_type": "vector",
  "reason": "one-line explanation",
  "entities": {
    "topics": [],
    "technologies": [],
    "people": [],
    "projects": []
  }
}"""


async def extract_entities(text: str) -> dict:
    try:
        raw = await generate_text(
            system=_ENTITY_SYSTEM,
            user=text[:6000],
            json_mode=True,
            max_tokens=512,
        )
        return json.loads(strip_json_fences(raw))
    except Exception:
        return {"topics": [], "technologies": [], "people": [], "projects": [], "decisions": []}


async def write_document_to_graph(
    file_id: str, filename: str, filetype: str, file_url: str,
    uploaded_by: str, part: str | None, entities: dict,
) -> None:
    if not neo4j_ready():
        return
    run_neo4j(
        "MERGE (d:Document {id:$id}) SET d.filename=$filename, d.filetype=$filetype, "
        "d.fileUrl=$fileUrl, d.uploadedBy=$uploadedBy, d.part=$part",
        {"id": file_id, "filename": filename, "filetype": filetype,
         "fileUrl": file_url, "uploadedBy": uploaded_by, "part": part},
    )
    for topic in entities.get("topics", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (t:Topic {name:$name}) MERGE (d)-[:COVERS]->(t)",
            {"id": file_id, "name": topic.lower()},
        )
    for tech in entities.get("technologies", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (t:Technology {name:$name}) MERGE (d)-[:MENTIONS_TECH]->(t)",
            {"id": file_id, "name": tech.lower()},
        )
    for person in entities.get("people", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (p:Person {name:$name}) MERGE (d)-[:MENTIONS_PERSON]->(p)",
            {"id": file_id, "name": person},
        )
    for project in entities.get("projects", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (p:Project {name:$name}) MERGE (d)-[:PART_OF]->(p)",
            {"id": file_id, "name": project.lower()},
        )
    for decision in entities.get("decisions", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) CREATE (dec:Decision {text:$text,documentId:$id}) MERGE (d)-[:RECORDS]->(dec)",
            {"id": file_id, "text": decision},
        )
    topics = [t.lower() for t in entities.get("topics", [])]
    for i, t1 in enumerate(topics):
        for t2 in topics[i + 1:]:
            run_neo4j(
                "MERGE (a:Topic {name:$a}) MERGE (b:Topic {name:$b}) MERGE (a)-[:RELATED_TO]-(b)",
                {"a": t1, "b": t2},
            )


def delete_document_from_graph(file_id: str) -> None:
    if not neo4j_ready():
        return
    run_neo4j(
        "MATCH (d:Document {id:$id}) OPTIONAL MATCH (d)-[:RECORDS]->(dec:Decision) "
        "DETACH DELETE d, dec",
        {"id": file_id},
    )


async def route_query(query: str) -> dict:
    try:
        raw = await generate_text(
            system=_ROUTE_SYSTEM,
            user=query,
            json_mode=True,
            max_tokens=512,
        )
        parsed = json.loads(strip_json_fences(raw))
        return {
            "search_type": parsed.get("search_type", "vector"),
            "reason": parsed.get("reason", ""),
            "entities": parsed.get("entities", {}),
        }
    except Exception:
        return {"search_type": "vector", "reason": "fallback", "entities": {}}


async def graph_search(entities: dict, part_filter: str | None) -> list[dict]:
    if not neo4j_ready():
        return []
    file_ids: set[str] = set()

    topics = [t.lower() for t in entities.get("topics", [])]
    technologies = [t.lower() for t in entities.get("technologies", [])]
    people = entities.get("people", [])
    projects = [p.lower() for p in entities.get("projects", [])]

    print(f"[graph] searching — topics={topics} techs={technologies} people={people} projects={projects}")

    if topics:
        rows = run_neo4j(
            "MATCH (d:Document)-[:COVERS]->(t:Topic) WHERE toLower(t.name) IN $topics RETURN DISTINCT d.id AS id",
            {"topics": topics},
        )
        found = [r["id"] for r in rows]
        print(f"[graph] topics direct match → {found}")
        file_ids.update(found)
        rows = run_neo4j(
            "MATCH (d:Document)-[:COVERS]->(t1:Topic)-[:RELATED_TO]-(t2:Topic) "
            "WHERE toLower(t1.name) IN $topics RETURN DISTINCT d.id AS id",
            {"topics": topics},
        )
        found = [r["id"] for r in rows]
        print(f"[graph] topics related match → {found}")
        file_ids.update(found)

    for rel, vals in [("MENTIONS_TECH", technologies), ("MENTIONS_PERSON", people), ("PART_OF", projects)]:
        if vals:
            rows = run_neo4j(
                f"MATCH (d:Document)-[:{rel}]->(n) WHERE toLower(n.name) IN $vals RETURN DISTINCT d.id AS id",
                {"vals": vals},
            )
            found = [r["id"] for r in rows]
            print(f"[graph] {rel} match → {found}")
            file_ids.update(found)

    print(f"[graph] total file_ids from Neo4j: {file_ids}")
    if not file_ids:
        return []

    placeholders = ",".join(["%s"] * len(file_ids))
    rows = fetch_all(f"""
        SELECT c.id, c.file_id, c.chunk_text, c.chunk_summary, c.chunk_index,
               f.filename, f.file_url, f.filetype, f.accessible_to
        FROM chunks c
        JOIN files f ON f.id = c.file_id
        WHERE c.file_id IN ({placeholders})
        ORDER BY c.chunk_index
        LIMIT 20
    """, tuple(file_ids))

    if part_filter:
        rows = [r for r in rows if part_filter in (r.get("accessible_to") or [])]

    return [
        {
            "chunk_text":  r["chunk_text"],
            "chunk_index": r["chunk_index"],
            "filename":    r["filename"],
            "file_url":    r["file_url"],
            "filetype":    r["filetype"],
            "file_id":     r["file_id"],
        }
        for r in rows
    ]
