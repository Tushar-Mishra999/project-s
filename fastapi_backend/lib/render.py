"""PDF / DOCX / XLSX rendering — replaces Puppeteer / html-to-docx / SheetJS."""
import io
from bs4 import BeautifulSoup


def render_pdf(html: str) -> bytes:
    from xhtml2pdf import pisa
    buf = io.BytesIO()
    pisa.CreatePDF(html, dest=buf)
    return buf.getvalue()


def render_docx(html: str) -> bytes:
    from docx import Document
    from htmldocx import HtmlToDocx
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
