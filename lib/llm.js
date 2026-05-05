// Thin wrapper around the Vertex AI / Agent Platform SDK so call sites stay clean.
//   - generateText: single-turn prompt with optional JSON mode
//   - generateChat: multi-turn conversation (Gemini)
//   - generateChatDeepseek: multi-turn conversation via Vertex OpenAI-compat endpoint
//
// Note on Gemini 2.5: these models burn "thinking tokens" before the visible
// answer. We disable thinking by default for predictable token budgets.
// Pass `thinking: true` if you want the model to reason internally first.
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';

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

let _deepseekAuth = null;
function deepseekAuthClient() {
  if (!_deepseekAuth) {
    _deepseekAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return _deepseekAuth;
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

// Multi-turn chat via Vertex AI dedicated endpoint (Gemma 4).
export async function generateChatGemma({ system, messages, maxTokens = 1024 }) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = 'us-central1';
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT not set');

  const token = await deepseekAuthClient().getAccessToken();
  if (!token) throw new Error('Could not obtain Google access token for Gemma call');

  // Gemma only supports 'user' and 'model' roles — merge system into first user turn.
  const allMessages = messages.map((m) => ({ ...m }));
  if (system && allMessages.length > 0 && allMessages[0].role === 'user') {
    allMessages[0].content = `${system}\n\n${allMessages[0].content}`;
  }
  const prompt = '<bos>' + allMessages
    .map((m) => `<start_of_turn>${m.role === 'assistant' ? 'model' : 'user'}\n${m.content}<end_of_turn>`)
    .join('\n') + '\n<start_of_turn>model\n';

  const resp = await fetch(
    `https://mg-endpoint-6e36e7de-7a34-4edd-b289-0d41d8035d63.us-central1-941913920085.prediction.vertexai.goog/v1/projects/${project}/locations/${location}/endpoints/mg-endpoint-6e36e7de-7a34-4edd-b289-0d41d8035d63:predict`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemma Vertex error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  // Response shape: { predictions: [{ content: "..." }] } or { predictions: ["..."] }
  const pred = json.predictions?.[0];
  return (typeof pred === 'string' ? pred : pred?.content || pred?.output || '').trim();
}
