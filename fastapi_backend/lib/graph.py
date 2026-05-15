"""Neo4j graph operations and query routing — mirrors lib/graphExtract.js."""
import json
from .llm import generate_text
from .clients import neo4j_ready, run_neo4j, get_supabase, config
from .rag import strip_json_fences

_ENTITY_SYSTEM = (
    'Extract entities from the following document text and return ONLY a JSON object:\n'
    '{"topics":[],"technologies":[],"people":[],"projects":[],"decisions":[]}\n'
    'Keep each list concise (max 10 items each). Return only valid JSON.'
)

_ROUTE_SYSTEM = (
    'Classify the user query as "vector" or "graph".\n'
    '"graph" = relational/cross-document questions: "all documents about", "everything related to", "across the knowledge base".\n'
    '"vector" = specific fact retrieval, single-topic explanation.\n'
    'Return ONLY JSON: {"search_type":"vector","reason":"brief explanation","entities":{"topics":[],"technologies":[],"people":[],"projects":[]}}'
)


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
            {"id": file_id, "name": topic},
        )
    for tech in entities.get("technologies", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (t:Technology {name:$name}) MERGE (d)-[:MENTIONS_TECH]->(t)",
            {"id": file_id, "name": tech},
        )
    for person in entities.get("people", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (p:Person {name:$name}) MERGE (d)-[:MENTIONS_PERSON]->(p)",
            {"id": file_id, "name": person},
        )
    for project in entities.get("projects", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) MERGE (p:Project {name:$name}) MERGE (d)-[:PART_OF]->(p)",
            {"id": file_id, "name": project},
        )
    for decision in entities.get("decisions", []):
        run_neo4j(
            "MATCH (d:Document {id:$id}) CREATE (dec:Decision {text:$text,documentId:$id}) MERGE (d)-[:RECORDS]->(dec)",
            {"id": file_id, "text": decision},
        )
    topics = entities.get("topics", [])
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
            max_tokens=256,
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

    topics = entities.get("topics", [])
    if topics:
        rows = run_neo4j(
            "MATCH (d:Document)-[:COVERS]->(t:Topic) WHERE t.name IN $topics RETURN d.id AS id",
            {"topics": topics},
        )
        file_ids.update(r["id"] for r in rows)
        rows = run_neo4j(
            "MATCH (d:Document)-[:COVERS]->(t1:Topic)-[:RELATED_TO]-(t2:Topic) "
            "WHERE t1.name IN $topics RETURN d.id AS id",
            {"topics": topics},
        )
        file_ids.update(r["id"] for r in rows)

    for rel, key in [("MENTIONS_TECH", "technologies"), ("MENTIONS_PERSON", "people"), ("PART_OF", "projects")]:
        vals = entities.get(key, [])
        if vals:
            rows = run_neo4j(
                f"MATCH (d:Document)-[:{rel}]->(n) WHERE n.name IN $vals RETURN d.id AS id",
                {"vals": vals},
            )
            file_ids.update(r["id"] for r in rows)

    if not file_ids:
        return []

    sb = get_supabase()
    q = sb.table("chunks").select(
        "id,file_id,chunk_text,chunk_summary,chunk_index,files(filename,file_url,filetype,accessible_to)"
    ).in_("file_id", list(file_ids)).limit(20)
    result = q.execute()
    chunks = result.data or []

    if part_filter:
        chunks = [
            c for c in chunks
            if part_filter in (c.get("files") or {}).get("accessible_to", [])
        ]

    # Flatten files join
    flat = []
    for c in chunks:
        f = c.pop("files", {}) or {}
        flat.append({**c, "filename": f.get("filename"), "file_url": f.get("file_url"), "filetype": f.get("filetype")})
    return flat
