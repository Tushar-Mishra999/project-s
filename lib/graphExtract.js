import { generateText } from './llm.js';
import { runQuery, neo4jReady } from './neo4j.js';
import { supabase } from './clients.js';
import { stripJsonFences } from './rag.js';

// ── Entity extraction ────────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `Extract structured entities from this document. Return JSON with exactly these fields:
- topics: broad concepts or subjects discussed (e.g. "cloud migration", "api design", "q3 planning")
- technologies: specific tools, platforms, frameworks, or languages mentioned
- people: full or partial person names mentioned
- projects: project names explicitly mentioned (empty array if none found)
- decisions: key decisions, conclusions, or recommendations stated (max 5, short phrases)

Return only valid JSON. Use lowercase for topics and technologies.`;

export async function extractEntities(text, model) {
  const raw = await generateText({
    model,
    system: EXTRACT_SYSTEM,
    user: text.slice(0, 6000),
    jsonMode: true,
    maxTokens: 2048,
  });
  try {
    const obj = JSON.parse(stripJsonFences(raw));
    return {
      topics:      Array.isArray(obj.topics)      ? obj.topics.map(String).filter(Boolean)      : [],
      technologies: Array.isArray(obj.technologies) ? obj.technologies.map(String).filter(Boolean) : [],
      people:      Array.isArray(obj.people)      ? obj.people.map(String).filter(Boolean)      : [],
      projects:    Array.isArray(obj.projects)    ? obj.projects.map(String).filter(Boolean)    : [],
      decisions:   Array.isArray(obj.decisions)   ? obj.decisions.map(String).filter(Boolean).slice(0, 5) : [],
    };
  } catch {
    return { topics: [], technologies: [], people: [], projects: [], decisions: [] };
  }
}

// ── Write document + entities to Neo4j ──────────────────────────────────────

export async function writeDocumentToGraph({ fileId, filename, filetype, fileUrl, uploadedBy, part, entities }) {
  if (!neo4jReady()) return;

  // Upsert Document node
  await runQuery(`
    MERGE (d:Document {id: $id})
    SET d.filename = $filename, d.filetype = $filetype,
        d.fileUrl  = $fileUrl,  d.uploadedBy = $uploadedBy, d.part = $part
  `, { id: fileId, filename, filetype, fileUrl: fileUrl || '', uploadedBy, part: part || '' });

  // Topics
  for (const topic of entities.topics) {
    await runQuery(`
      MERGE (t:Topic {name: $name})
      WITH t MATCH (d:Document {id: $id})
      MERGE (d)-[:COVERS]->(t)
    `, { name: topic.toLowerCase(), id: fileId });
  }

  // Technologies
  for (const tech of entities.technologies) {
    await runQuery(`
      MERGE (t:Technology {name: $name})
      WITH t MATCH (d:Document {id: $id})
      MERGE (d)-[:MENTIONS_TECH]->(t)
    `, { name: tech.toLowerCase(), id: fileId });
  }

  // People
  for (const person of entities.people) {
    await runQuery(`
      MERGE (p:Person {name: $name})
      WITH p MATCH (d:Document {id: $id})
      MERGE (d)-[:MENTIONS_PERSON]->(p)
    `, { name: person, id: fileId });
  }

  // Projects
  for (const project of entities.projects) {
    await runQuery(`
      MERGE (p:Project {name: $name})
      WITH p MATCH (d:Document {id: $id})
      MERGE (d)-[:PART_OF]->(p)
    `, { name: project, id: fileId });
  }

  // Decisions
  for (const decision of entities.decisions) {
    await runQuery(`
      MATCH (d:Document {id: $id})
      MERGE (dec:Decision {text: $text, documentId: $id})
      MERGE (d)-[:RECORDS]->(dec)
    `, { id: fileId, text: decision });
  }

  // Topic co-occurrence edges (connect topics that appear in the same document)
  const topicNames = entities.topics.map((t) => t.toLowerCase());
  if (topicNames.length > 1) {
    await runQuery(`
      UNWIND $topics AS t1name
      UNWIND $topics AS t2name
      WITH t1name, t2name WHERE t1name < t2name
      MATCH (t1:Topic {name: t1name}), (t2:Topic {name: t2name})
      MERGE (t1)-[:RELATED_TO]-(t2)
    `, { topics: topicNames });
  }

  console.log(`[graph] indexed ${filename}: ${entities.topics.length} topics, ${entities.technologies.length} techs, ${entities.people.length} people, ${entities.projects.length} projects`);
}

// ── Delete document from Neo4j ───────────────────────────────────────────────

export async function deleteDocumentFromGraph(fileId) {
  if (!neo4jReady()) return;
  try {
    await runQuery(`
      MATCH (d:Document {id: $id})
      OPTIONAL MATCH (d)-[:RECORDS]->(dec:Decision)
      DETACH DELETE dec
      WITH d
      DETACH DELETE d
    `, { id: fileId });
  } catch (err) {
    console.warn('[graph] delete failed:', err.message);
  }
}

// ── Query router ─────────────────────────────────────────────────────────────

const ROUTER_SYSTEM = `You are a search router for a knowledge management system.

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
  "search_type": "vector" | "graph",
  "reason": "one-line explanation",
  "entities": {
    "topics": [],
    "technologies": [],
    "people": [],
    "projects": []
  }
}`;

export async function routeQuery(query, model) {
  try {
    const raw = await generateText({
      model,
      system: ROUTER_SYSTEM,
      user: query,
      jsonMode: true,
      maxTokens: 512,
    });
    const obj = JSON.parse(stripJsonFences(raw));
    return {
      search_type: obj.search_type === 'graph' ? 'graph' : 'vector',
      reason: String(obj.reason || ''),
      entities: {
        topics:       Array.isArray(obj.entities?.topics)       ? obj.entities.topics.map(String)       : [],
        technologies: Array.isArray(obj.entities?.technologies) ? obj.entities.technologies.map(String) : [],
        people:       Array.isArray(obj.entities?.people)       ? obj.entities.people.map(String)       : [],
        projects:     Array.isArray(obj.entities?.projects)     ? obj.entities.projects.map(String)     : [],
      },
    };
  } catch {
    return { search_type: 'vector', reason: 'router fallback', entities: { topics: [], technologies: [], people: [], projects: [] } };
  }
}

// ── Graph search ─────────────────────────────────────────────────────────────
// 1. Find relevant document IDs in Neo4j by matching entities.
// 2. Fetch chunk texts from Supabase for those documents.
// Returns chunks in the same shape as the vector retrieve() result.

export async function graphSearch({ entities, partFilter }) {
  if (!neo4jReady()) return [];

  const { topics, technologies, people, projects } = entities;
  const fileIds = new Set();

  // Helper: collect IDs from a Cypher query
  const collect = async (cypher, params) => {
    try {
      const records = await runQuery(cypher, params);
      records.forEach((r) => fileIds.add(r.get('id')));
    } catch (err) {
      console.warn('[graph] query error:', err.message);
    }
  };

  // Topics — direct match + one hop via RELATED_TO
  if (topics.length > 0) {
    const lc = topics.map((t) => t.toLowerCase());
    await collect(`
      MATCH (d:Document)-[:COVERS]->(t:Topic)
      WHERE t.name IN $topics
      RETURN DISTINCT d.id AS id
    `, { topics: lc });
    await collect(`
      MATCH (d:Document)-[:COVERS]->(t1:Topic)-[:RELATED_TO]-(t2:Topic)
      WHERE t2.name IN $topics
      RETURN DISTINCT d.id AS id
    `, { topics: lc });
  }

  // Technologies
  if (technologies.length > 0) {
    await collect(`
      MATCH (d:Document)-[:MENTIONS_TECH]->(t:Technology)
      WHERE t.name IN $techs
      RETURN DISTINCT d.id AS id
    `, { techs: technologies.map((t) => t.toLowerCase()) });
  }

  // People
  if (people.length > 0) {
    await collect(`
      MATCH (d:Document)-[:MENTIONS_PERSON]->(p:Person)
      WHERE p.name IN $people
      RETURN DISTINCT d.id AS id
    `, { people });
  }

  // Projects
  if (projects.length > 0) {
    await collect(`
      MATCH (d:Document)-[:PART_OF]->(p:Project)
      WHERE p.name IN $projects
      RETURN DISTINCT d.id AS id
    `, { projects });
  }

  if (fileIds.size === 0) return [];

  // Fetch chunks from Supabase for the matched documents
  if (!supabase) return [];
  let query = supabase
    .from('chunks')
    .select('chunk_text, chunk_index, file_id, files!inner(filename, file_url, filetype, accessible_to)')
    .in('file_id', [...fileIds])
    .order('chunk_index')
    .limit(20);

  const { data, error } = await query;
  if (error || !data) return [];

  // Apply part filter if present
  const filtered = partFilter
    ? data.filter((c) => c.files?.accessible_to?.includes(partFilter))
    : data;

  return filtered.map((c) => ({
    chunk_text:  c.chunk_text,
    chunk_index: c.chunk_index,
    filename:    c.files?.filename || '',
    file_url:    c.files?.file_url || '',
    filetype:    c.files?.filetype || '',
    file_id:     c.file_id,
  }));
}
