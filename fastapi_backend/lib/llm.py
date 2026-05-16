"""Temporary: LLM calls via Vertex AI (Gemini 2.5 Flash).
To switch back to Ollama, replace this file with lib/llm_ollama.py."""
from __future__ import annotations
import os
import asyncio
import tempfile
from typing import AsyncGenerator
from google import genai
from google.genai import types

# ── Credentials: write JSON from env var to temp file (same as Node.js server.js) ──
_creds_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
if _creds_json and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
    _tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w")
    _tmp.write(_creds_json)
    _tmp.close()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _tmp.name

GOOGLE_CLOUD_PROJECT  = os.getenv("GOOGLE_CLOUD_PROJECT", "")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
GEMINI_MODEL          = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
EMBED_MODEL           = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")

# Alias so call sites that import OLLAMA_MODEL still work
OLLAMA_MODEL = GEMINI_MODEL

_client = genai.Client(
    vertexai=True,
    project=GOOGLE_CLOUD_PROJECT,
    location=GOOGLE_CLOUD_LOCATION,
)

# ── Cached credentials object for embeddings ──────────────────────────────
_google_creds = None

def _get_vertex_token() -> str:
    global _google_creds
    import google.auth
    import google.auth.transport.requests
    if _google_creds is None:
        creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        if creds_path:
            from google.oauth2 import service_account
            _google_creds = service_account.Credentials.from_service_account_file(
                creds_path,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
        else:
            _google_creds, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
    _google_creds.refresh(google.auth.transport.requests.Request())
    return _google_creds.token


def _make_config(system: str, max_tokens: int, json_mode: bool = False) -> types.GenerateContentConfig:
    kwargs: dict = {
        "max_output_tokens": max_tokens,
        "thinking_config": types.ThinkingConfig(thinking_budget=0),
    }
    if system:
        kwargs["system_instruction"] = system
    if json_mode:
        kwargs["response_mime_type"] = "application/json"
    return types.GenerateContentConfig(**kwargs)


def _build_contents(messages: list[dict]) -> list[types.Content]:
    return [
        types.Content(
            role="model" if m.get("role") == "assistant" else "user",
            parts=[types.Part(text=m.get("content", ""))],
        )
        for m in messages
    ]


async def generate_text(
    system: str,
    user: str,
    model: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 4096,
) -> str:
    response = await _client.aio.models.generate_content(
        model=model or GEMINI_MODEL,
        contents=user,
        config=_make_config(system, max_tokens, json_mode),
    )
    return response.text or ""


async def generate_chat(
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 4096,
) -> str:
    response = await _client.aio.models.generate_content(
        model=model or GEMINI_MODEL,
        contents=_build_contents(messages),
        config=_make_config(system, max_tokens),
    )
    return response.text or ""


async def generate_chat_stream(
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 4096,
) -> AsyncGenerator[str, None]:
    async for chunk in _client.aio.models.generate_content_stream(
        model=model or GEMINI_MODEL,
        contents=_build_contents(messages),
        config=_make_config(system, max_tokens),
    ):
        if chunk.text:
            yield chunk.text


async def embed_text(text: str) -> list[float]:
    """Vertex AI text-embedding-004 via REST — 768-dim, matches ChromaDB collections."""
    import httpx
    token = await asyncio.to_thread(_get_vertex_token)
    url = (
        f"https://{GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1"
        f"/projects/{GOOGLE_CLOUD_PROJECT}/locations/{GOOGLE_CLOUD_LOCATION}"
        f"/publishers/google/models/{EMBED_MODEL}:predict"
    )
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "instances": [{"content": text[:8000], "task_type": "RETRIEVAL_QUERY"}],
                "parameters": {"outputDimensionality": 768},
            },
        )
    resp.raise_for_status()
    return resp.json()["predictions"][0]["embeddings"]["values"]
