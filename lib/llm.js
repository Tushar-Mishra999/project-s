// Thin wrapper around the Vertex AI / Agent Platform SDK so call sites stay clean.
//   - generateText: single-turn prompt with optional JSON mode
//   - generateChat: multi-turn conversation
//
// Note on Gemini 2.5: these models burn "thinking tokens" before the visible
// answer. We disable thinking by default for predictable token budgets.
// Pass `thinking: true` if you want the model to reason internally first.
import { GoogleGenAI } from '@google/genai';

let _ai = null;
function client() {
  if (!_ai) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set — ensure GOOGLE_APPLICATION_CREDENTIALS_JSON is configured');
    }
    _ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });
  }
  return _ai;
}

function buildConfig({ system, jsonMode, maxTokens, thinking, tools }) {
  const config = { maxOutputTokens: maxTokens };
  if (system) config.systemInstruction = system;
  if (jsonMode) config.responseMimeType = 'application/json';
  if (!thinking) config.thinkingConfig = { thinkingBudget: 0 };
  if (tools) config.tools = tools;
  return config;
}

function extractText(resp) {
  if (resp.text && typeof resp.text === 'string') return resp.text.trim();
  const parts = resp.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p) => p.text || '').join('').trim();
  // Some shapes put text directly on candidate.
  const direct = resp.candidates?.[0]?.text;
  return (direct || '').trim();
}

export async function generateText({
  model,
  system,
  user,
  jsonMode = false,
  maxTokens = 1024,
  thinking = false,
  tools,
}) {
  const resp = await client().models.generateContent({
    model,
    contents: user,
    config: buildConfig({ system, jsonMode, maxTokens, thinking, tools }),
  });
  const finishReason = resp.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    console.warn(`[llm] generateText finished with non-STOP reason: ${finishReason} (model=${model}, maxTokens=${maxTokens})`);
  }
  return extractText(resp);
}

export async function generateWithParts({ model, system, parts, maxTokens = 2048, thinking = false }) {
  const resp = await client().models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: buildConfig({ system, maxTokens, thinking }),
  });
  return extractText(resp);
}

export async function generateChat({
  model,
  system,
  messages,
  maxTokens = 1024,
  thinking = true, // thinking helps for grounded answers
}) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const resp = await client().models.generateContent({
    model,
    contents,
    config: buildConfig({ system, jsonMode: false, maxTokens, thinking }),
  });
  return extractText(resp);
}
