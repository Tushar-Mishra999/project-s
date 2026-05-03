// Minimal Markdown -> .docx renderer.
// Builds the .docx (which is a zip of XML files) by hand, using marked to
// tokenise the markdown. We avoid `html-to-docx` because its OOXML output
// is regularly malformed for common markdown constructs, producing files
// Word refuses to open.
//
// Supported: headings (h1-h3), paragraphs, bold/italic/code inline,
// bullet & numbered lists (single level), code blocks, blockquotes,
// horizontal rules, links (rendered as text with the URL in parens).
// Tables degrade to plain-text rows, which is acceptable.

import JSZip from 'jszip';
import { marked } from 'marked';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Render an array of marked inline tokens to a sequence of <w:r> runs.
function renderInline(tokens) {
  if (!tokens) return '';
  let xml = '';
  const walk = (toks, fmt = {}) => {
    for (const t of toks || []) {
      switch (t.type) {
        case 'strong':  walk(t.tokens, { ...fmt, b: true }); break;
        case 'em':      walk(t.tokens, { ...fmt, i: true }); break;
        case 'codespan':xml += run(t.text || '', { ...fmt, code: true }); break;
        case 'del':     walk(t.tokens, { ...fmt, strike: true }); break;
        case 'br':      xml += '<w:r><w:br/></w:r>'; break;
        case 'link': {
          const text = (t.tokens && t.tokens.length)
            ? renderInlineToText(t.tokens)
            : (t.text || t.href || '');
          xml += run(`${text} (${t.href})`, fmt);
          break;
        }
        case 'image':   xml += run(`[image: ${t.text || t.href}]`, fmt); break;
        case 'text':
          if (t.tokens && t.tokens.length) walk(t.tokens, fmt);
          else xml += run(t.text || '', fmt);
          break;
        case 'escape':  xml += run(t.text || '', fmt); break;
        case 'html':    xml += run(t.text || '', fmt); break; // strip tags by treating as text
        default:        xml += run(t.raw || t.text || '', fmt);
      }
    }
  };
  walk(tokens);
  return xml;
}

function renderInlineToText(tokens) {
  return (tokens || []).map((t) => t.text || t.raw || '').join('');
}

function run(text, fmt = {}) {
  if (!text) return '';
  const props = [];
  if (fmt.b)      props.push('<w:b/>');
  if (fmt.i)      props.push('<w:i/>');
  if (fmt.strike) props.push('<w:strike/>');
  if (fmt.code)   props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // xml:space="preserve" keeps leading/trailing whitespace in runs.
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(content, opts = {}) {
  const props = [];
  if (opts.style)    props.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.numId)    props.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
  if (opts.alignment)props.push(`<w:jc w:val="${opts.alignment}"/>`);
  const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}${content}</w:p>`;
}

function tokensToParagraphs(tokens) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const style = t.depth === 1 ? 'Heading1' : t.depth === 2 ? 'Heading2' : 'Heading3';
        out.push(paragraph(renderInline(t.tokens), { style }));
        break;
      }
      case 'paragraph':
        out.push(paragraph(renderInline(t.tokens)));
        break;
      case 'list': {
        const numId = t.ordered ? 2 : 1;
        for (const item of t.items) {
          const inline = item.tokens
            .filter((x) => x.type === 'text' || x.type === 'paragraph')
            .flatMap((x) => x.tokens || [{ type: 'text', text: x.text || '' }]);
          out.push(paragraph(renderInline(inline), { numId }));
          // Render any nested non-inline tokens (e.g. nested lists) as plain
          // paragraphs underneath — keeps things readable without nesting OOXML.
          for (const sub of item.tokens) {
            if (sub.type !== 'text' && sub.type !== 'paragraph') {
              out.push(...tokensToParagraphs([sub]));
            }
          }
        }
        break;
      }
      case 'code': {
        const lines = (t.text || '').split('\n');
        for (const line of lines) {
          out.push(paragraph(run(line, { code: true })));
        }
        break;
      }
      case 'blockquote':
        out.push(...tokensToParagraphs(t.tokens || []));
        break;
      case 'hr':
        out.push(paragraph(run('────────────────────────', {})));
        break;
      case 'space':
        out.push('<w:p/>');
        break;
      case 'table': {
        // Render each row as a paragraph of `cell | cell | cell`.
        const headerLine = (t.header || []).map((h) => renderInlineToText(h.tokens || [{ text: h.text || '' }])).join(' | ');
        if (headerLine.trim()) out.push(paragraph(run(headerLine, { b: true })));
        for (const row of t.rows || []) {
          const line = row.map((cell) => renderInlineToText(cell.tokens || [{ text: cell.text || '' }])).join(' | ');
          out.push(paragraph(run(line, {})));
        }
        break;
      }
      case 'html':
        // Treat raw HTML as plain text (strip tags).
        out.push(paragraph(run((t.raw || '').replace(/<[^>]+>/g, ''), {})));
        break;
      default:
        if (t.text) out.push(paragraph(run(t.text, {})));
    }
  }
  return out;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

export async function markdownToDocxBuffer(markdown) {
  const tokens = marked.lexer(markdown || '');
  const paragraphs = tokensToParagraphs(tokens);
  if (paragraphs.length === 0) paragraphs.push('<w:p/>');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.folder('_rels').file('.rels', ROOT_RELS_XML);
  const word = zip.folder('word');
  word.file('document.xml', documentXml);
  word.file('styles.xml', STYLES_XML);
  word.file('numbering.xml', NUMBERING_XML);
  word.folder('_rels').file('document.xml.rels', DOCUMENT_RELS_XML);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
