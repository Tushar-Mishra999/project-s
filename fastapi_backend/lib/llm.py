"""Temporary: LLM calls via Gemini 2.5 Flash (no local Ollama needed).
To switch back to Ollama, replace this file with lib/llm_ollama.py."""
from __future__ import annotations
import os
import asyncio
from typing import AsyncGenerator
import google.generativeai as genai

GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL     = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "models/text-embedding-004")

# Alias so existing call sites that import OLLAMA_MODEL still work
OLLAMA_MODEL = GEMINI_MODEL

genai.configure(api_key=GEMINI_API_KEY)


def _model(name: str, system: str) -> genai.GenerativeModel:
    return genai.GenerativeModel(name, system_instruction=system or None)


def _cfg(max_tokens: int, json_mode: bool = False) -> genai.GenerationConfig:
    kwargs: dict = {"max_output_tokens": max_tokens}
    if json_mode:
        kwargs["response_mime_type"] = "application/json"
    return genai.GenerationConfig(**kwargs)


def _contents(messages: list[dict]) -> list[dict]:
    return [
        {"role": "model" if m.get("role") == "assistant" else "user",
         "parts": [{"text": m.get("content", "")}]}
        for m in messages
    ]


async def generate_text(
    system: str,
    user: str,
    model: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 4096,
) -> str:
    response = await _model(model or GEMINI_MODEL, system).generate_content_async(
        user, generation_config=_cfg(max_tokens, json_mode)
    )
    return response.text or ""


async def generate_chat(
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 4096,
) -> str:
    response = await _model(model or GEMINI_MODEL, system).generate_content_async(
        _contents(messages), generation_config=_cfg(max_tokens)
    )
    return response.text or ""


async def generate_chat_stream(
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 4096,
) -> AsyncGenerator[str, None]:
    response = await _model(model or GEMINI_MODEL, system).generate_content_async(
        _contents(messages), generation_config=_cfg(max_tokens), stream=True
    )
    async for chunk in response:
        if chunk.text:
            yield chunk.text


async def embed_text(text: str) -> list[float]:
    result = await asyncio.to_thread(
        genai.embed_content,
        model=GEMINI_EMBED_MODEL,
        content=text,
    )
    return list(result["embedding"])
