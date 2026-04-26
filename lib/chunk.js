// Intelligent chunking:
//   - PPTX: one chunk per slide (passed in via `slides`)
//   - PDF / DOCX with detected headings: chunk on heading boundaries
//   - Otherwise: paragraph-merged chunks of CHUNK_MIN..CHUNK_MAX words

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function chunkDocument(extracted, opts) {
  const { text, headings = [], slides } = extracted;
  const min = opts.chunk_min_words ?? 300;
  const max = opts.chunk_max_words ?? 600;

  if (slides && slides.length) {
    return slides
      .map((s, i) => ({ text: s.trim(), heading: `Slide ${i + 1}` }))
      .filter((c) => c.text.length > 0);
  }

  if (headings.length >= 2) {
    return chunkByHeadings(text, headings, min, max);
  }

  return chunkByParagraphs(text, min, max);
}

function chunkByHeadings(text, headings, min, max) {
  const lines = text.split('\n');
  const headingLineSet = new Map(headings.map((h) => [h.line, h.text]));
  const sections = [];
  let current = { heading: null, lines: [] };
  for (let i = 0; i < lines.length; i++) {
    if (headingLineSet.has(i)) {
      if (current.lines.length || current.heading) sections.push(current);
      current = { heading: headingLineSet.get(i), lines: [] };
    } else {
      current.lines.push(lines[i]);
    }
  }
  if (current.lines.length || current.heading) sections.push(current);

  // First pass: split any oversized sections, keep undersized ones as-is.
  const expanded = [];
  for (const sec of sections) {
    const body = sec.lines.join('\n').trim();
    const headerLine = sec.heading ? sec.heading : '';
    const combined = [headerLine, body].filter(Boolean).join('\n\n');
    if (!combined.trim()) continue;
    if (wordCount(combined) <= max) {
      expanded.push({ heading: sec.heading, body, words: wordCount(combined) });
    } else {
      const sub = chunkByParagraphs(body, min, max);
      for (const s of sub) {
        expanded.push({ heading: sec.heading, body: s.text, words: wordCount(s.text) });
      }
    }
  }

  // Second pass: merge consecutive undersized sections until each chunk
  // reaches `min` words (or we hit the next would-be-overflow).
  const merged = [];
  let buf = null;
  const flush = () => {
    if (buf && (buf.body.trim() || buf.heading)) {
      const text = [buf.heading, buf.body].filter(Boolean).join('\n\n').trim();
      merged.push({ text, heading: buf.heading });
    }
    buf = null;
  };
  for (const sec of expanded) {
    if (!buf) {
      buf = { heading: sec.heading, body: sec.body, words: sec.words };
      continue;
    }
    if (buf.words + sec.words <= max && buf.words < min) {
      // append
      buf.body = [buf.body, sec.heading ? `[${sec.heading}]` : '', sec.body]
        .filter(Boolean).join('\n\n');
      buf.words += sec.words;
    } else {
      flush();
      buf = { heading: sec.heading, body: sec.body, words: sec.words };
    }
  }
  flush();
  return merged;
}

function chunkByParagraphs(text, min, max) {
  const paras = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [];
  let buf = [];
  let bufWords = 0;
  for (const p of paras) {
    const w = wordCount(p);
    if (bufWords + w > max && bufWords >= min) {
      out.push({ text: buf.join('\n\n'), heading: null });
      buf = [p];
      bufWords = w;
    } else {
      buf.push(p);
      bufWords += w;
    }
  }
  if (buf.length) out.push({ text: buf.join('\n\n'), heading: null });
  return out;
}

// Add a context prefix (nearest heading) to each chunk's stored text.
export function addContextPrefix(chunks) {
  return chunks.map((c, i) => ({
    text: c.heading ? `[${c.heading}]\n\n${c.text}` : c.text,
    heading: c.heading,
    index: i,
  }));
}
