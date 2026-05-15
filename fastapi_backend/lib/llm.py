"""All LLM calls go through Ollama. Model is configured via OLLAMA_MODEL env var."""
import os
import json
from typing import AsyncGenerator
from ollama import AsyncClient

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

_client = AsyncClient(host=OLLAMA_BASE_URL)


async def generate_text(
    system: str,
    user: str,
    model: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 4096,
) -> str:
    model = model or OLLAMA_MODEL
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "options": {"num_predict": max_tokens},
    }
    if json_mode:
        kwargs["format"] = "json"

    response = await _client.chat(**kwargs)
    return response.message.content or ""


async def generate_chat(
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 4096,
) -> str:
    model = model or OLLAMA_MODEL
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    for m in messages:
        role = "assistant" if m.get("role") == "assistant" else "user"
        msgs.append({"role": role, "content": m.get("content", "")})

    response = await _client.chat(
        model=model,
        messages=msgs,
        options={"num_predict": max_tokens},
    )
    return response.message.content or ""


async def generate_chat_stream(
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 4096,
) -> AsyncGenerator[str, None]:
    model = model or OLLAMA_MODEL
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    for m in messages:
        role = "assistant" if m.get("role") == "assistant" else "user"
        msgs.append({"role": role, "content": m.get("content", "")})

    async for chunk in await _client.chat(
        model=model,
        messages=msgs,
        stream=True,
        options={"num_predict": max_tokens},
    ):
        content = chunk.message.content
        if content:
            yield content


async def embed_text(text: str) -> list[float]:
    response = await _client.embeddings(model=OLLAMA_EMBED_MODEL, prompt=text)
    return list(response.embedding)
