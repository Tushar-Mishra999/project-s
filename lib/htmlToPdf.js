import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const PAGE_CSS = `
  body { font-family: Calibri, 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.6; color: #1a1a2e; margin: 0; }
  h1 { font-size: 22pt; font-weight: bold; color: #1a1a2e; border-bottom: 2px solid #3b82f6; padding-bottom: 6pt; margin-top: 20pt; margin-bottom: 10pt; }
  h2 { font-size: 16pt; font-weight: bold; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4pt; margin-top: 16pt; margin-bottom: 8pt; }
  h3 { font-size: 13pt; font-weight: bold; color: #334155; margin-top: 12pt; margin-bottom: 6pt; }
  p { margin: 6pt 0; line-height: 1.6; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
  th { background-color: #1e293b; color: #ffffff; padding: 8pt 10pt; text-align: left; font-size: 10pt; border: 1px solid #cbd5e1; }
  td { padding: 7pt 10pt; font-size: 10pt; border: 1px solid #e2e8f0; }
  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin-bottom: 4pt; line-height: 1.5; }
  code { font-family: Consolas, monospace; font-size: 10pt; background-color: #f1f5f9; padding: 1pt 4pt; border-radius: 3pt; }
  blockquote { border-left: 3pt solid #94a3b8; padding: 6pt 12pt; margin: 8pt 0; color: #475569; background-color: #f8fafc; }
  nav { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14pt 20pt; margin: 16pt 0; background-color: #f8fafc; }
`;

export async function htmlToPdfBuffer(html) {
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body>${html}</body></html>`;
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
