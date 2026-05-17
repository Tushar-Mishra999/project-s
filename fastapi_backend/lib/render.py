"""PDF / DOCX / XLSX rendering — replaces Puppeteer / html-to-docx / SheetJS."""
import io
import re
from bs4 import BeautifulSoup

_FENCE_RE = re.compile(r'^```(?:html)?\s*|\s*```$', re.MULTILINE)

def _strip_fences(html: str) -> str:
    return _FENCE_RE.sub('', html).strip()

# Matches Node.js htmlToPdf.js PAGE_CSS exactly
_PAGE_CSS = """
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
"""

def _wrap_html(html: str) -> str:
    return f'<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_PAGE_CSS}</style></head><body>{html}</body></html>'


async def render_pdf(html: str) -> bytes:
    html = _strip_fences(html)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(_wrap_html(html), wait_until="networkidle")
                pdf = await page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "20mm", "right": "15mm", "bottom": "20mm", "left": "15mm"},
                )
                return pdf
            finally:
                await browser.close()
    except ImportError:
        return _render_pdf_fallback(html)


def _render_pdf_fallback(html: str) -> bytes:
    """xhtml2pdf fallback when Playwright is not installed."""
    from xhtml2pdf import pisa
    _FALLBACK_CSS = f"<style>{_PAGE_CSS} div,section,article {{border:none!important;box-shadow:none!important;}}</style>"
    sanitized = _sanitize_tables_for_xhtml2pdf(html)
    full = _FALLBACK_CSS + sanitized
    buf = io.BytesIO()
    pisa.CreatePDF(full, dest=buf)
    return buf.getvalue()


# CSS properties that crash xhtml2pdf table rendering
_TABLE_STYLE_STRIP = re.compile(
    r'border-collapse\s*:[^;]+;?\s*|border-radius\s*:[^;]+;?\s*|box-shadow\s*:[^;]+;?\s*',
    re.IGNORECASE,
)

def _sanitize_tables_for_xhtml2pdf(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(["colgroup", "col"]):
        tag.decompose()
    for table in soup.find_all("table"):
        if table.get("style"):
            table["style"] = _TABLE_STYLE_STRIP.sub("", table["style"]).strip().rstrip(";")
    for tr in soup.find_all("tr"):
        style = re.sub(r'height\s*:[^;]+;?\s*', '', tr.get("style", ""), flags=re.IGNORECASE)
        if style.strip():
            tr["style"] = style
        elif "style" in tr.attrs:
            del tr["style"]
    body = soup.find("body")
    return "".join(str(c) for c in body.children) if body else html


def render_docx(html: str) -> bytes:
    from docx import Document
    from htmldocx import HtmlToDocx
    html = _strip_fences(html)
    doc = Document()
    HtmlToDocx().add_html_to_document(html, doc)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def render_xlsx(html: str) -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    soup = BeautifulSoup(html, "lxml")
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    tables = soup.find_all("table")
    if not tables:
        ws = wb.create_sheet("Report")
        for i, elem in enumerate(soup.find_all(["h1", "h2", "h3", "p", "li"]), 1):
            ws.cell(row=i, column=1, value=elem.get_text(strip=True))
    else:
        for t_idx, table in enumerate(tables):
            prev_heading = table.find_previous(["h1", "h2", "h3"])
            sheet_name = (prev_heading.get_text(strip=True)[:31] if prev_heading else f"Sheet{t_idx + 1}")
            ws = wb.create_sheet(title=sheet_name)
            header_fill = PatternFill("solid", fgColor="1E293B")
            header_font = Font(color="FFFFFF", bold=True, size=10)
            for r_idx, row in enumerate(table.find_all("tr"), 1):
                cells = row.find_all(["th", "td"])
                for c_idx, cell in enumerate(cells, 1):
                    val = cell.get_text(strip=True)
                    ws_cell = ws.cell(row=r_idx, column=c_idx, value=val)
                    if cell.name == "th":
                        ws_cell.fill = header_fill
                        ws_cell.font = header_font
                    ws_cell.alignment = Alignment(wrap_text=True)
                    col_letter = ws_cell.column_letter
                    current = ws.column_dimensions[col_letter].width
                    ws.column_dimensions[col_letter].width = max(current, min(len(val) + 2, 40))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()



def render_docx(html: str) -> bytes:
    from docx import Document
    from htmldocx import HtmlToDocx
    html = _strip_fences(html)
    doc = Document()
    HtmlToDocx().add_html_to_document(html, doc)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def render_xlsx(html: str) -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    soup = BeautifulSoup(html, "lxml")
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    tables = soup.find_all("table")
    if not tables:
        ws = wb.create_sheet("Report")
        for i, elem in enumerate(soup.find_all(["h1", "h2", "h3", "p", "li"]), 1):
            ws.cell(row=i, column=1, value=elem.get_text(strip=True))
    else:
        for t_idx, table in enumerate(tables):
            prev_heading = table.find_previous(["h1", "h2", "h3"])
            sheet_name = (prev_heading.get_text(strip=True)[:31] if prev_heading else f"Sheet{t_idx + 1}")
            ws = wb.create_sheet(title=sheet_name)
            header_fill = PatternFill("solid", fgColor="1E293B")
            header_font = Font(color="FFFFFF", bold=True, size=10)
            for r_idx, row in enumerate(table.find_all("tr"), 1):
                cells = row.find_all(["th", "td"])
                for c_idx, cell in enumerate(cells, 1):
                    val = cell.get_text(strip=True)
                    ws_cell = ws.cell(row=r_idx, column=c_idx, value=val)
                    if cell.name == "th":
                        ws_cell.fill = header_fill
                        ws_cell.font = header_font
                    ws_cell.alignment = Alignment(wrap_text=True)
                    # Auto-width approximation
                    col_letter = ws_cell.column_letter
                    current = ws.column_dimensions[col_letter].width
                    ws.column_dimensions[col_letter].width = max(current, min(len(val) + 2, 40))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
