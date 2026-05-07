// Extract text + structural hints from PDF / DOCX / PPTX / TXT / XLSX buffers.
// Returns { text, headings: [{line, level}], slides?: [string] }
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

// pdf-parse ships an unfortunate top-level test that runs on import in ESM —
// require it lazily to avoid the "ENOENT ./test/data" startup error.
const require = createRequire(import.meta.url);

export async function extractText(buffer, filetype) {
  const t = (filetype || '').toLowerCase();
  if (t.includes('pdf')) return extractPdf(buffer);
  if (t.includes('word') || t.includes('docx')) return extractDocx(buffer);
  if (t.includes('presentation') || t.includes('pptx')) return extractPptx(buffer);
  if (t.includes('spreadsheet') || t.includes('xlsx') || t.includes('xls') || t.includes('excel')) return extractExcel(buffer);
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
  // Use raw text extraction — convertToHtml drops table content silently.
  const out = await mammoth.extractRawText({ buffer });
  const text = (out.value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const headings = detectHeadingsFromText(text);
  return { text, headings };
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

async function extractExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`Sheet: ${sheetName}\n${csv}`);
  }
  const text = parts.join('\n\n').replace(/\r\n/g, '\n');
  const headings = workbook.SheetNames.map((name, i) => ({ line: i, level: 2, text: `Sheet: ${name}` }));
  return { text, headings };
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
//   - Markdown style:           #, ##, ### at line start
//   - Numbered sections:        "1. Title", "2.1 Subtitle"
//   - Short ALL-CAPS lines:     "OVERVIEW", "ACTION ITEMS"
//   - Title Case short lines:   "Action Items", "Decisions Made"
function detectHeadingsFromText(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Markdown
    const md = line.match(/^(#{1,4})\s+(.+)/);
    if (md) {
      out.push({ line: i, level: md[1].length, text: md[2].trim() });
      continue;
    }

    // Numbered: "1. Foo", "1.2 Foo", "1) Foo"
    const numbered = line.match(/^(\d+(?:\.\d+)*)[\.\)]\s+(\S.{1,80})$/);
    if (numbered && line.split(/\s+/).length <= 12 && !line.endsWith('.')) {
      out.push({ line: i, level: numbered[1].includes('.') ? 3 : 2, text: line });
      continue;
    }

    const wordCount = line.split(/\s+/).length;
    const letters = line.replace(/[^A-Za-z]/g, '');

    // ALL-CAPS short
    if (
      wordCount <= 8 &&
      letters.length >= 4 &&
      letters === letters.toUpperCase()
    ) {
      out.push({ line: i, level: 2, text: line });
      continue;
    }

    // Title Case short — every word starts uppercase, no trailing punctuation,
    // followed by a blank line (so it looks like a section header, not body text).
    if (
      wordCount >= 1 && wordCount <= 6 &&
      letters.length >= 4 &&
      !/[.!?,;:]$/.test(line) &&
      /^[A-Z]/.test(line) &&
      line.split(/\s+/).every((w) => /^[A-Z0-9]/.test(w) || w.length <= 2) &&
      (lines[i + 1] === undefined || lines[i + 1].trim() === '')
    ) {
      out.push({ line: i, level: 2, text: line });
    }
  }
  return out;
}
