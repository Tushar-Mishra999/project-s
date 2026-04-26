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
      if (current.lines.length) sections.push(current);
      current = { heading: headingLineSet.get(i), lines: [] };
    } else {
      current.lines.push(lines[i]);
    }
  }
  if (current.lines.length) sections.push(current);

  // For each section, split if too long
  const chunks = [];
  for (const sec of sections) {
    const body = sec.lines.join('\n').trim();
    if (!body) continue;
    if (wordCount(body) <= max) {
      chunks.push({ text: body, heading: sec.heading });
    } else {
      // Split overly-long sections by paragraph, prepending the heading.
      const sub = chunkByParagraphs(body, min, max);
      for (const s of sub) chunks.push({ text: s.text, heading: sec.heading });
    }
  }
  return chunks;
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
