// Thin wrapper around the Vertex AI / Agent Platform SDK so call sites stay clean.
//   - generateText: single-turn prompt with optional JSON mode
//   - generateChat: multi-turn conversation (Gemini)
//   - generateChatGemma: multi-turn conversation via Vertex OpenAI-compat endpoint (Gemma 4)
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

const GEMINI_TIMEOUT_MS = 300_000; // 5 minutes — large reports need time

export async function generateText({
  model,
  system,
  user,
  jsonMode = false,
  maxTokens = 1024,
  thinking = false,
  tools,
}) {
  const resp = await client().models.generateContent(
    { model, contents: user, config: buildConfig({ system, jsonMode, maxTokens, thinking, tools }) },
    { timeout: GEMINI_TIMEOUT_MS },
  );
  const finishReason = resp.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    console.warn(`[llm] generateText finished with non-STOP reason: ${finishReason} (model=${model}, maxTokens=${maxTokens})`);
  }
  return extractText(resp);
}

export async function generateTextWithSearch({ model, user, maxTokens = 4000 }) {
  const resp = await client().models.generateContent(
    {
      model,
      contents: user,
      config: {
        maxOutputTokens: maxTokens,
        systemInstruction: 'You are a data extraction assistant. Return only valid JSON objects. No markdown, no explanation.',
        tools: [{ googleSearch: {} }],
      },
    },
    { timeout: GEMINI_TIMEOUT_MS },
  );
  console.log(`[llm] generateTextWithSearch response: ${JSON.stringify(resp)}`);
  const groundingChunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return { text: extractText(resp), groundingChunks };
}

export async function generateWithParts({ model, system, parts, maxTokens = 2048, thinking = false }) {
  const resp = await client().models.generateContent(
    { model, contents: [{ role: 'user', parts }], config: buildConfig({ system, maxTokens, thinking }) },
    { timeout: GEMINI_TIMEOUT_MS },
  );
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
  const resp = await client().models.generateContent(
    { model, contents, config: buildConfig({ system, jsonMode: false, maxTokens, thinking }) },
    { timeout: GEMINI_TIMEOUT_MS },
  );
  return extractText(resp);
}

export async function* generateChatStream({ model, system, messages, maxTokens = 4096 }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const stream = client().models.generateContentStream(
    { model, contents, config: buildConfig({ system, jsonMode: false, maxTokens, thinking: false }) },
    { timeout: GEMINI_TIMEOUT_MS },
  );
  for await (const chunk of stream) {
    const text = extractText(chunk);
    if (text) yield text;
  }
}

async function* parseMaaSStream(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch { /* ignore malformed chunk */ }
      }
    }
  }
}

async function* streamMaaS({ project, region, token, model, messages, maxTokens }) {
  const resp = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7, stream: true }),
      signal: AbortSignal.timeout(300_000),
    }
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`MaaS stream error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  yield* parseMaaSStream(resp);
}

async function maasStreamArgs(label) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT not set');
  const token = await deepseekAuthClient().getAccessToken();
  if (!token) throw new Error(`Could not obtain Google access token for ${label} stream`);
  return { project, region, token };
}

function buildOpenAIMessages(system, messages) {
  return [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];
}

export async function* generateChatGemmaStream({ system, messages, maxTokens = 2048 }) {
  const { project, region, token } = await maasStreamArgs('Gemma');
  yield* streamMaaS({ project, region, token, model: 'google/gemma-4-26b-a4b-it-maas', messages: buildOpenAIMessages(system, messages), maxTokens });
}

export async function* generateChatGLMStream({ system, messages, maxTokens = 2048 }) {
  const { project, region, token } = await maasStreamArgs('GLM');
  yield* streamMaaS({ project, region, token, model: 'zai-org/glm-5-maas', messages: buildOpenAIMessages(system, messages), maxTokens });
}

export async function* generateChatGPTOSSStream({ system, messages, maxTokens = 2048 }) {
  const { project, region, token } = await maasStreamArgs('GPT OSS');
  yield* streamMaaS({ project, region, token, model: 'openai/gpt-oss-20b-maas', messages: buildOpenAIMessages(system, messages), maxTokens });
}

// Multi-turn chat via Vertex AI Model Garden MaaS endpoint (Gemma 4 26B).
// Uses the OpenAI-compatible /chat/completions path — native system role, clean response.

export async function generateChatGemma({ system, messages, maxTokens = 2048 }) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT not set');

  const token = await deepseekAuthClient().getAccessToken();
  if (!token) throw new Error('Could not obtain Google access token for Gemma call');

  const openaiMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];

  const resp = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: 'google/gemma-4-26b-a4b-it-maas',
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemma Vertex error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  return json.choices[0].message.content.trim();
}

export async function generateChatGLM({ system, messages, maxTokens = 2048 }) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT not set');

  const token = await deepseekAuthClient().getAccessToken();
  if (!token) throw new Error('Could not obtain Google access token for GLM call');

  const openaiMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];

  const resp = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: 'zai-org/glm-5-maas',
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GLM Vertex error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  return json.choices[0].message.content.trim();
}

export async function generateChatGPTOSS({ system, messages, maxTokens = 2048 }) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT not set');

  const token = await deepseekAuthClient().getAccessToken();
  if (!token) throw new Error('Could not obtain Google access token for GPT OSS call');

  const openaiMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];

  const resp = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b-maas',
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GPT OSS Vertex error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  return json.choices[0].message.content.trim();
}

