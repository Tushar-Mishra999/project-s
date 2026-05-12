// RAG pipeline: enrich chunks (Gemini), embed (Google text-embedding-004 via Vertex AI), retrieve + rerank (Gemini).
import { GoogleGenAI } from '@google/genai';
import { generateText } from './llm.js';

let _embedAI = null;
function embedClient() {
  if (!_embedAI) {
    _embedAI = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });
  }
  return _embedAI;
}

const ENRICH_SYSTEM = `Given a text chunk, return a JSON object with exactly these fields:
- summary: a 2-3 sentence summary of the chunk
- keywords: array of 5-8 specific keywords or keyphrases
- hypothetical_questions: array of 3-5 questions a user might ask that this chunk would answer

Return only valid JSON.`;

const RERANK_SYSTEM = `You are a document retrieval reranker. Given a user query and a list of document chunks, return a JSON array of the indices of the top 5 most relevant chunks in order of relevance, e.g. [3, 0, 7, 12, 1].`;

export function stripJsonFences(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return t;
}

function parseJsonStrict(raw, label) {
  try {
    return JSON.parse(stripJsonFences(raw));
  } catch (err) {
    const obj = raw.match(/\{[\s\S]*\}/);
    const arr = raw.match(/\[[\s\S]*\]/);
    const candidate = obj?.[0] || arr?.[0];
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        /* fall through */
      }
    }
    console.error(`[${label}] JSON parse failed. Raw response:\n`, raw);
    throw err;
  }
}

export async function enrichChunk(chunkText, model) {
  const raw = await generateText({
    model,
    system: ENRICH_SYSTEM,
    user: chunkText.slice(0, 12000),
    jsonMode: true,
    maxTokens: 1024,
  });
  const obj = parseJsonStrict(raw, 'enrich');
  return {
    summary: String(obj.summary || ''),
    keywords: Array.isArray(obj.keywords) ? obj.keywords.map(String) : [],
    hypothetical_questions: Array.isArray(obj.hypothetical_questions)
      ? obj.hypothetical_questions.map(String)
      : [],
  };
}

export async function embedText(text, model = 'text-embedding-004', inputType) {
  const taskType = inputType === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY';
  const response = await embedClient().models.embedContent({
    model,
    content: text.slice(0, 8000),
    config: { taskType, outputDimensionality: 768 },
  });
  return response.embeddings[0].values;
}

export function buildEmbeddingInput(enriched) {
  return [
    enriched.summary,
    (enriched.keywords || []).join(', '),
    (enriched.hypothetical_questions || []).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function rerankChunks(query, chunks, model) {
  if (chunks.length <= 5) return chunks;
  const payload = chunks.map((c, i) => ({
    id: i,
    summary: c.chunk_summary || '',
    text: (c.chunk_text || '').slice(0, 800),
  }));
  const raw = await generateText({
    model,
    system: RERANK_SYSTEM,
    user: `Query: ${query}\n\nChunks:\n${JSON.stringify(payload)}`,
    jsonMode: true,
    maxTokens: 2000,
  });
  let indices;
  try {
    indices = parseJsonStrict(raw, 'rerank');
  } catch {
    return chunks.slice(0, 5);
  }
  if (!Array.isArray(indices)) return chunks.slice(0, 5);
  const seen = new Set();
  const picked = [];
  for (const i of indices) {
    const idx = Number(i);
    if (Number.isInteger(idx) && idx >= 0 && idx < chunks.length && !seen.has(idx)) {
      picked.push(chunks[idx]);
      seen.add(idx);
      if (picked.length === 5) break;
    }
  }
  return picked.length ? picked : chunks.slice(0, 5);
}
