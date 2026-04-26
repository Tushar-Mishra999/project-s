// Render the first page of a PDF (by URL) to a small thumbnail dataURL.
// pdfjs-dist loaded lazily so it never blocks tab 1 / tab 3.
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const cache = new Map();

export async function renderPdfThumbnail(url, width = 220) {
  if (cache.has(url)) return cache.get(url);
  const doc = await pdfjsLib.getDocument(url).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const scale = width / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
  const data = canvas.toDataURL('image/png');
  cache.set(url, data);
  return data;
}
