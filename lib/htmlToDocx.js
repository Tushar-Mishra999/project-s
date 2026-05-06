import HTMLtoDOCX from 'html-to-docx';

const PAGE_STYLES = `
  body { font-family: Calibri, sans-serif; font-size: 11pt; line-height: 1.4; }
  h1 { font-size: 20pt; font-weight: bold; margin-top: 18pt; margin-bottom: 6pt; }
  h2 { font-size: 16pt; font-weight: bold; margin-top: 14pt; margin-bottom: 5pt; }
  h3 { font-size: 13pt; font-weight: bold; margin-top: 12pt; margin-bottom: 4pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 4pt 6pt; }
  th { background-color: #f2f2f2; font-weight: bold; }
  code { font-family: Consolas, monospace; font-size: 10pt; }
  blockquote { border-left: 3pt solid #ccc; padding-left: 8pt; color: #555; }
`;

export async function htmlToDocxBuffer(html) {
  const wrapped = `<!DOCTYPE html><html><head><style>${PAGE_STYLES}</style></head><body>${html}</body></html>`;
  const buf = await HTMLtoDOCX(wrapped, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  return Buffer.from(buf);
}
