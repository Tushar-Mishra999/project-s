"""Chunking logic — mirrors lib/chunk.js."""


def _word_count(text: str) -> int:
    return len(text.split())


def _split_on_headings(text: str, headings: list[dict]) -> list[str]:
    if not headings:
        return [text]
    lines = text.splitlines()
    segments = []
    prev = 0
    for h in headings:
        line_no = h["line"]
        chunk = "\n".join(lines[prev:line_no]).strip()
        if chunk:
            segments.append(chunk)
        prev = line_no
    tail = "\n".join(lines[prev:]).strip()
    if tail:
        segments.append(tail)
    return segments


def _merge_short(segments: list[str], min_words: int) -> list[str]:
    merged = []
    buf = ""
    for seg in segments:
        if buf:
            candidate = buf + "\n\n" + seg
            if _word_count(buf) < min_words:
                buf = candidate
                continue
        if buf:
            merged.append(buf)
        buf = seg
    if buf:
        merged.append(buf)
    return merged


def _split_long(text: str, max_words: int) -> list[str]:
    if _word_count(text) <= max_words:
        return [text]
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    buf = ""
    for para in paragraphs:
        candidate = (buf + "\n\n" + para).strip() if buf else para
        if _word_count(candidate) <= max_words:
            buf = candidate
        else:
            if buf:
                chunks.append(buf)
            buf = para
    if buf:
        chunks.append(buf)
    return chunks if chunks else [text]


def chunk_document(extracted: dict, rag_config: dict) -> list[dict]:
    text = extracted.get("text", "")
    headings = extracted.get("headings", [])
    slides = extracted.get("slides")
    min_words = rag_config.get("chunk_min_words", 300)
    max_words = rag_config.get("chunk_max_words", 600)

    if slides is not None:
        return [{"text": s, "heading": None} for s in slides if s.strip()]

    if headings:
        segments = _split_on_headings(text, headings)
        segments = _merge_short(segments, min_words)
        raw = []
        for seg in segments:
            raw.extend(_split_long(seg, max_words))
    else:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        buf = ""
        raw = []
        for para in paragraphs:
            candidate = (buf + "\n\n" + para).strip() if buf else para
            if _word_count(candidate) <= max_words:
                buf = candidate
            else:
                if buf:
                    raw.append(buf)
                buf = para
        if buf:
            raw.append(buf)

    # Attach nearest heading
    heading_lines = {h["line"]: h["text"] for h in headings}
    sorted_lines = sorted(heading_lines.keys())
    lines = text.splitlines()
    results = []
    for chunk_text in raw:
        # Find which line this chunk starts at
        first_line = chunk_text.strip().splitlines()[0] if chunk_text.strip() else ""
        nearest = None
        for i, line in enumerate(lines):
            if line.strip() == first_line:
                candidates = [l for l in sorted_lines if l <= i]
                if candidates:
                    nearest = heading_lines[candidates[-1]]
                break
        results.append({"text": chunk_text, "heading": nearest})

    return results


def add_context_prefix(chunks: list[dict]) -> list[dict]:
    for c in chunks:
        if c.get("heading"):
            c["text"] = f"[Section: {c['heading']}]\n{c['text']}"
    return chunks
