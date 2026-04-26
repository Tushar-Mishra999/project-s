// Extract text + structural hints from PDF / DOCX / PPTX / TXT buffers.
// Returns { text, headings: [{line, level}], slides?: [string] }
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import JSZip from 'jszip';

// pdf-parse ships an unfortunate top-level test that runs on import in ESM —
// require it lazily to avoid the "ENOENT ./test/data" startup error.
const require = createRequire(import.meta.url);

export async function extractText(buffer, filetype) {
  const t = (filetype || '').toLowerCase();
  if (t.includes('pdf')) return extractPdf(buffer);
  if (t.includes('word') || t.includes('docx')) return extractDocx(buffer);
  if (t.includes('presentation') || t.includes('pptx')) return extractPptx(buffer);
  return { text: buffer.toString('utf-8'), headings: [] };
}

async function extractPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const out = await pdfParse(buffer);
  const text = (out.text || '').replace(/\r\n/g, '\n');
  const headings = detectHeadingsFromText(text);
  return { text, headings };
}

async function extractDocx(buffer) {
  // Use HTML conversion so we can recover heading levels.
  const html = await mammoth.convertToHtml({ buffer });
  const blocks = [];
  const headings = [];
  const re = /<(h[1-6]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  let line = 0;
  while ((m = re.exec(html.value)) !== null) {
    const tag = m[1].toLowerCase();
    const txt = stripTags(m[2]).trim();
    if (!txt) continue;
    if (/^h[1-6]$/.test(tag)) {
      headings.push({ line, level: Number(tag[1]), text: txt });
    }
    blocks.push(txt);
    line += 1;
  }
  return { text: blocks.join('\n\n'), headings };
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)[1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)[1]);
      return na - nb;
    });
  const slides = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
    const text = matches
      .map((tok) => tok.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    slides.push(text);
  }
  return { text: slides.join('\n\n'), headings: [], slides };
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

// Fallback heading detection from raw text:
//   - Markdown style:  #, ##, ### at line start
//   - Short ALL-CAPS lines (<= 8 words)
function detectHeadingsFromText(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const md = line.match(/^(#{1,4})\s+(.+)/);
    if (md) {
      out.push({ line: i, level: md[1].length, text: md[2].trim() });
      continue;
    }
    const wordCount = line.split(/\s+/).length;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (
      wordCount <= 8 &&
      letters.length >= 4 &&
      letters === letters.toUpperCase()
    ) {
      out.push({ line: i, level: 2, text: line });
    }
  }
  return out;
}
