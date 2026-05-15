import json
import re
from .llm import generate_text
from .rag import strip_json_fences

_SYSTEM = (
    'Extract action items from the document. Return ONLY a JSON array:\n'
    '[{"id":"<uuid>","text":"action item text","completed":false}]\n'
    'Each item must be a clear, specific task. Max 20 items. Return [] if none found.'
)


async def extract_action_items(text: str) -> list[dict]:
    import uuid
    try:
        raw = await generate_text(
            system=_SYSTEM,
            user=text[:8000],
            json_mode=True,
            max_tokens=1024,
        )
        items = json.loads(strip_json_fences(raw))
        if isinstance(items, list):
            for item in items:
                if not item.get("id"):
                    item["id"] = str(uuid.uuid4())
                item.setdefault("completed", False)
            return items
    except Exception:
        pass
    # Regex fallback — look for lines starting with action verbs
    items = []
    pattern = re.compile(
        r'^\s*[-•*]\s*((?:review|update|send|create|prepare|schedule|follow|complete|implement|draft|check|report|discuss|coordinate)\b.+)',
        re.IGNORECASE | re.MULTILINE,
    )
    import uuid
    for m in pattern.finditer(text[:8000]):
        items.append({"id": str(uuid.uuid4()), "text": m.group(1).strip(), "completed": False})
    return items[:20]
