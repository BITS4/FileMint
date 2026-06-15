#!/usr/bin/env python3
"""Premium PDF export helpers for FileMint.

Targets:
  * XLSX: extract native PDF tables where possible, then fall back to grouped
    text rows so the workbook is still editable.
  * PPTX: preserve exact page visuals as slide backgrounds and add an
    invisible editable/searchable text layer when text can be extracted.
  * HTML: create a self-contained visual preview with selectable text spans.

This is a local/offline converter. For scanned PDFs, OCR is attempted when
Tesseract is available; otherwise the report clearly marks visual fallback.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import math
import os
import statistics
import tempfile
from dataclasses import dataclass
from typing import Any

import fitz

from pdf_to_docx import inspect_pdf, parse_tsv, resolve_ocr_language, run_tesseract_tsv


@dataclass
class TextLine:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    font_size: float
    conf: float = 100.0


@dataclass
class TextWord:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    conf: float = 100.0


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", "").split())


def points_to_emu(value: float) -> int:
    return int(value / 72.0 * 914400)


def make_report(src: str, target: str, mode: str = "premium") -> dict[str, Any]:
    info = inspect_pdf(src)
    return {
        "engine": "filemint-pdf-export",
        "requestedMode": mode,
        "resolvedMode": f"premium-pdf-to-{target}",
        "pdfType": info["pdfType"],
        "pagesConverted": info["pages"],
        "editableTextDetected": False,
        "tablesDetected": info["tablesDetected"],
        "imagesDetected": info["imagesDetected"],
        "lowConfidenceOcrAreas": 0,
        "editableTextBoxes": 0,
        "editableCharacters": 0,
        "ocrTextCandidates": 0,
        "textCoverageEstimate": 0,
        "visualObjectsPreserved": info["pages"],
        "hiddenTextLayer": False,
        "tablesRebuiltAsWord": 0,
        "ocrPasses": [],
        "ocrLanguage": None,
        "tableDetectionEnabled": True,
        "layoutPreservationEnabled": True,
        "nonEditableVisualFallback": False,
        "warnings": [],
        "notes": [],
    }


def render_page_png(page: fitz.Page, dst: str, dpi: int = 160) -> tuple[int, int]:
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    pix.save(dst)
    return pix.width, pix.height


def join_positioned_words(words: list[TextWord]) -> str:
    if not words:
        return ""
    ordered = sorted(words, key=lambda w: w.x0)
    heights = [max(1.0, w.y1 - w.y0) for w in ordered]
    avg_height = statistics.median(heights) if heights else 10.0
    pieces = [ordered[0].text]
    last_right = ordered[0].x1
    for word in ordered[1:]:
        gap = max(0.0, word.x0 - last_right)
        pieces.append(" " * max(1, min(8, round(gap / max(3.0, avg_height * 0.36)))))
        pieces.append(word.text)
        last_right = max(last_right, word.x1)
    return "".join(pieces).strip()


def native_words(page: fitz.Page) -> list[TextWord]:
    out: list[TextWord] = []
    for item in page.get_text("words", sort=True) or []:
        x0, y0, x1, y1, text = item[:5]
        text = clean_text(text)
        if text:
            out.append(TextWord(text=text, x0=float(x0), y0=float(y0), x1=float(x1), y1=float(y1)))
    return out


def words_to_lines(words: list[TextWord]) -> list[TextLine]:
    if not words:
        return []
    ordered = sorted(words, key=lambda w: (w.y0, w.x0))
    heights = [max(1.0, w.y1 - w.y0) for w in ordered]
    tolerance = max(3.0, (statistics.median(heights) if heights else 10.0) * 0.55)
    rows: list[list[TextWord]] = []
    centers: list[float] = []
    for word in ordered:
        cy = (word.y0 + word.y1) / 2.0
        best = None
        best_dist = 999999.0
        for i, center in enumerate(centers):
            dist = abs(cy - center)
            if dist < best_dist:
                best = i
                best_dist = dist
        if best is None or best_dist > tolerance:
            rows.append([word])
            centers.append(cy)
        else:
            rows[best].append(word)
            centers[best] = statistics.mean([(w.y0 + w.y1) / 2.0 for w in rows[best]])

    lines: list[TextLine] = []
    for row in rows:
        row = sorted(row, key=lambda w: w.x0)
        text = join_positioned_words(row)
        if not text:
            continue
        x0 = min(w.x0 for w in row)
        y0 = min(w.y0 for w in row)
        x1 = max(w.x1 for w in row)
        y1 = max(w.y1 for w in row)
        confs = [w.conf for w in row if w.conf >= 0]
        lines.append(
            TextLine(
                text=text,
                x0=x0,
                y0=y0,
                x1=x1,
                y1=y1,
                font_size=max(6.0, min(32.0, (y1 - y0) * 0.78)),
                conf=statistics.mean(confs) if confs else 100.0,
            )
        )
    return sorted(lines, key=lambda line: (line.y0, line.x0))


def ocr_words_for_page(page: fitz.Page, tmpdir: str, lang: str, report: dict[str, Any]) -> list[TextWord]:
    image = os.path.join(tmpdir, f"ocr-page-{page.number + 1}.png")
    px_w, px_h = render_page_png(page, image, dpi=220)
    tsv = run_tesseract_tsv(image, lang, psm="11")
    lines = parse_tsv(tsv, px_w, px_h, page.rect.width, page.rect.height)
    out: list[TextWord] = []
    for line in lines:
        for word in line.words:
            x0 = word.left / px_w * page.rect.width
            y0 = word.top / px_h * page.rect.height
            x1 = (word.left + word.width) / px_w * page.rect.width
            y1 = (word.top + word.height) / px_h * page.rect.height
            text = clean_text(word.text)
            if text:
                out.append(TextWord(text=text, x0=x0, y0=y0, x1=x1, y1=y1, conf=word.conf))
                if 0 <= word.conf < 55:
                    report["lowConfidenceOcrAreas"] += 1
    report["ocrTextCandidates"] += len(out)
    if "psm-11" not in report["ocrPasses"]:
        report["ocrPasses"].append("psm-11")
    return out


def page_text_words(
    page: fitz.Page,
    tmpdir: str,
    lang: str | None,
    report: dict[str, Any],
    allow_ocr: bool,
) -> list[TextWord]:
    words = native_words(page)
    if words or not allow_ocr or not lang:
        return words
    try:
        return ocr_words_for_page(page, tmpdir, lang, report)
    except Exception as exc:
        report["warnings"].append(f"OCR text layer failed on page {page.number + 1}: {exc}")
        return []


def page_text_lines(
    page: fitz.Page,
    tmpdir: str,
    lang: str | None,
    report: dict[str, Any],
    allow_ocr: bool,
) -> list[TextLine]:
    return words_to_lines(page_text_words(page, tmpdir, lang, report, allow_ocr))


def update_text_metrics(report: dict[str, Any], lines: list[TextLine]) -> None:
    chars = sum(len(line.text) for line in lines)
    report["editableTextBoxes"] += len(lines)
    report["editableCharacters"] += chars
    if chars > 0:
        report["editableTextDetected"] = True
    candidates = max(1, int(report.get("ocrTextCandidates") or 0))
    if report.get("pdfType") == "scanned" and report.get("ocrTextCandidates"):
        report["textCoverageEstimate"] = min(100, round(chars / candidates * 8))
    elif chars:
        report["textCoverageEstimate"] = 100


def maybe_resolve_ocr(src: str, requested_lang: str, text_layer: bool, report: dict[str, Any]) -> str | None:
    if not text_layer:
        return None
    if report.get("pdfType") != "scanned" and report.get("pdfType") != "mixed":
        return None
    try:
        return resolve_ocr_language(requested_lang, report)
    except Exception as exc:
        report["warnings"].append(str(exc))
        return None


def export_html(src: str, dst: str, report: dict[str, Any], lang: str, text_layer: bool) -> None:
    doc = fitz.open(src)
    ocr_lang = maybe_resolve_ocr(src, lang, text_layer, report)
    parts = [
        "<!doctype html>",
        '<html lang="und">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>FileMint PDF Export</title>",
        "<style>",
        "body{margin:0;background:#2a2f35;font-family:Arial,sans-serif;}",
        ".page{position:relative;margin:18px auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.28);overflow:hidden;}",
        ".page img{position:absolute;inset:0;width:100%;height:100%;}",
        ".text{position:absolute;white-space:pre;color:transparent;line-height:1;transform-origin:left top;}",
        ".text::selection{background:rgba(45,121,255,.35);color:transparent;}",
        "</style>",
        "</head>",
        "<body>",
    ]
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            for page in doc:
                image = os.path.join(tmpdir, f"page-{page.number + 1}.png")
                px_w, px_h = render_page_png(page, image, dpi=160)
                data = base64.b64encode(open(image, "rb").read()).decode("ascii")
                width = round(page.rect.width * 160 / 72.0, 2)
                height = round(page.rect.height * 160 / 72.0, 2)
                parts.append(f'<section class="page" style="width:{width}px;height:{height}px">')
                parts.append(f'<img alt="Page {page.number + 1}" src="data:image/png;base64,{data}">')
                if text_layer:
                    lines = page_text_lines(page, tmpdir, ocr_lang, report, allow_ocr=True)
                    update_text_metrics(report, lines)
                    scale = 160 / 72.0
                    for line in lines:
                        left = line.x0 * scale
                        top = line.y0 * scale
                        fs = max(6.0, line.font_size * scale)
                        safe = html.escape(line.text)
                        parts.append(
                            f'<span class="text" style="left:{left:.2f}px;top:{top:.2f}px;font-size:{fs:.2f}px">{safe}</span>'
                        )
                parts.append("</section>")
            report["hiddenTextLayer"] = bool(text_layer and report["editableTextDetected"])
            if report["hiddenTextLayer"]:
                report["notes"].append("HTML keeps exact page visuals and overlays selectable transparent text.")
            else:
                report["nonEditableVisualFallback"] = True
                report["warnings"].append("No text layer was available for this HTML export.")
        finally:
            doc.close()
    parts.append("</body></html>")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))


def set_pptx_run_transparent(run: Any) -> None:
    from pptx.oxml.ns import qn
    from pptx.oxml.xmlchemy import OxmlElement

    r_pr = run._r.get_or_add_rPr()
    for child in list(r_pr):
        if child.tag == qn("a:solidFill"):
            r_pr.remove(child)
    solid = OxmlElement("a:solidFill")
    color = OxmlElement("a:srgbClr")
    color.set("val", "000000")
    alpha = OxmlElement("a:alpha")
    alpha.set("val", "0")
    color.append(alpha)
    solid.append(color)
    r_pr.append(solid)


def export_pptx(src: str, dst: str, report: dict[str, Any], lang: str, text_layer: bool) -> None:
    from pptx import Presentation
    from pptx.util import Pt

    doc = fitz.open(src)
    if len(doc) == 0:
        raise RuntimeError("PDF contains no pages.")
    prs = Presentation()
    prs.slide_width = points_to_emu(doc[0].rect.width)
    prs.slide_height = points_to_emu(doc[0].rect.height)
    blank = prs.slide_layouts[6]
    ocr_lang = maybe_resolve_ocr(src, lang, text_layer, report)

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            for page in doc:
                slide = prs.slides.add_slide(blank)
                image = os.path.join(tmpdir, f"slide-{page.number + 1}.png")
                render_page_png(page, image, dpi=180)
                slide.shapes.add_picture(image, 0, 0, width=prs.slide_width, height=prs.slide_height)
                if text_layer:
                    lines = page_text_lines(page, tmpdir, ocr_lang, report, allow_ocr=True)
                    update_text_metrics(report, lines)
                    sx = prs.slide_width / page.rect.width
                    sy = prs.slide_height / page.rect.height
                    for line in lines:
                        if not line.text.strip():
                            continue
                        left = int(line.x0 * sx)
                        top = int(line.y0 * sy)
                        width = max(points_to_emu(8), int(max(8.0, line.x1 - line.x0) * sx))
                        height = max(points_to_emu(7), int(max(7.0, line.y1 - line.y0) * sy))
                        box = slide.shapes.add_textbox(left, top, width, height)
                        box.text_frame.margin_left = 0
                        box.text_frame.margin_right = 0
                        box.text_frame.margin_top = 0
                        box.text_frame.margin_bottom = 0
                        p = box.text_frame.paragraphs[0]
                        run = p.add_run()
                        run.text = line.text
                        run.font.size = Pt(max(4.0, min(28.0, line.font_size)))
                        set_pptx_run_transparent(run)
            if text_layer and report["editableTextDetected"]:
                report["hiddenTextLayer"] = True
                report["notes"].append(
                    "PowerPoint slides preserve exact PDF visuals as backgrounds with editable transparent text boxes on top."
                )
            else:
                report["nonEditableVisualFallback"] = True
                report["warnings"].append("PowerPoint export used page images because no reliable text layer was available.")
        finally:
            doc.close()
    prs.save(dst)


def native_tables(page: fitz.Page) -> list[list[list[str]]]:
    tables: list[list[list[str]]] = []
    try:
        found = page.find_tables()
        for table in getattr(found, "tables", []) or []:
            data = table.extract()
            cleaned = [[clean_text(cell) for cell in row] for row in data if any(clean_text(c) for c in row)]
            if cleaned:
                tables.append(cleaned)
    except Exception:
        return []
    return tables


def row_segments(words: list[TextWord]) -> list[str]:
    if not words:
        return []
    words = sorted(words, key=lambda w: w.x0)
    heights = [max(1.0, w.y1 - w.y0) for w in words]
    h = statistics.median(heights) if heights else 10.0
    segments: list[list[TextWord]] = [[words[0]]]
    last_right = words[0].x1
    for word in words[1:]:
        gap = word.x0 - last_right
        if gap > max(18.0, h * 1.7):
            segments.append([word])
        else:
            segments[-1].append(word)
        last_right = max(last_right, word.x1)
    return [join_positioned_words(segment) for segment in segments if join_positioned_words(segment)]


def words_to_grid(words: list[TextWord]) -> list[list[str]]:
    if not words:
        return []
    ordered = sorted(words, key=lambda w: (w.y0, w.x0))
    heights = [max(1.0, w.y1 - w.y0) for w in ordered]
    tolerance = max(4.0, (statistics.median(heights) if heights else 10.0) * 0.7)
    rows: list[list[TextWord]] = []
    centers: list[float] = []
    for word in ordered:
        cy = (word.y0 + word.y1) / 2.0
        idx = None
        for i, center in enumerate(centers):
            if abs(cy - center) <= tolerance:
                idx = i
                break
        if idx is None:
            rows.append([word])
            centers.append(cy)
        else:
            rows[idx].append(word)
            centers[idx] = statistics.mean([(w.y0 + w.y1) / 2.0 for w in rows[idx]])
    grid = [row_segments(row) for row in rows]
    return [row for row in grid if any(clean_text(c) for c in row)]


def style_sheet(ws: Any, max_row: int, max_col: int) -> None:
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    thin = Side(style="thin", color="C9D3DF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_fill = PatternFill("solid", fgColor="EAF2FF")
    for row in ws.iter_rows(min_row=1, max_row=max_row, max_col=max_col):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = border
            if cell.row == 1:
                cell.font = Font(bold=True, color="1F2937")
                cell.fill = header_fill
    for col in range(1, max_col + 1):
        letter = get_column_letter(col)
        longest = 0
        for row in range(1, max_row + 1):
            value = ws.cell(row=row, column=col).value
            longest = max(longest, len(str(value or "")))
        ws.column_dimensions[letter].width = max(10, min(38, longest + 2))
    ws.freeze_panes = "A2"


def safe_sheet_name(name: str) -> str:
    cleaned = "".join(c for c in name if c not in r"[]:*?/\\").strip() or "Sheet"
    return cleaned[:31]


def export_xlsx(src: str, dst: str, report: dict[str, Any], lang: str, table_detection: bool) -> None:
    from openpyxl import Workbook

    doc = fitz.open(src)
    wb = Workbook()
    wb.remove(wb.active)
    ocr_lang = maybe_resolve_ocr(src, lang, True, report)
    table_count = 0
    inferred_table_count = 0
    cells_written = 0
    chars_written = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            for page in doc:
                page_tables = native_tables(page) if table_detection else []
                if page_tables:
                    for idx, table in enumerate(page_tables, start=1):
                        table_count += 1
                        ws = wb.create_sheet(safe_sheet_name(f"Page {page.number + 1} Table {idx}"))
                        for r, row in enumerate(table, start=1):
                            for c, value in enumerate(row, start=1):
                                ws.cell(r, c, value)
                                if value:
                                    cells_written += 1
                                    chars_written += len(value)
                        style_sheet(ws, len(table), max(len(row) for row in table))
                    continue

                words = page_text_words(page, tmpdir, ocr_lang, report, allow_ocr=True)
                grid = words_to_grid(words)
                ws = wb.create_sheet(safe_sheet_name(f"Page {page.number + 1}"))
                if not grid:
                    ws["A1"] = "No extractable text or table structure was detected on this page."
                    report["warnings"].append(f"Page {page.number + 1} exported without editable table/text cells.")
                    report["nonEditableVisualFallback"] = True
                    continue
                for r, row in enumerate(grid, start=1):
                    for c, value in enumerate(row, start=1):
                        ws.cell(r, c, value)
                        if value:
                            cells_written += 1
                            chars_written += len(value)
                max_cols = max(len(row) for row in grid)
                if len(grid) >= 3 and max_cols >= 2:
                    inferred_table_count += 1
                style_sheet(ws, len(grid), max_cols)
        finally:
            doc.close()

    if not wb.worksheets:
        wb.create_sheet("Result")
        wb.active["A1"] = "No pages were converted."

    report["tablesDetected"] = max(int(report.get("tablesDetected") or 0), table_count + inferred_table_count)
    report["editableTextBoxes"] = cells_written
    report["editableCharacters"] = chars_written
    report["editableTextDetected"] = cells_written > 0
    report["textCoverageEstimate"] = 100 if cells_written else 0
    if table_count:
        report["notes"].append(f"Excel export rebuilt {table_count} native PDF table(s) as editable worksheets.")
    elif inferred_table_count:
        report["notes"].append("Excel export inferred editable table-like worksheets from positioned PDF/OCR text.")
    elif cells_written:
        report["notes"].append("Excel export grouped PDF text into editable rows and columns.")
    wb.save(dst)


def write_report(path: str | None, report: dict[str, Any]) -> None:
    if not path:
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--target", required=True, choices=["xlsx", "pptx", "html"])
    parser.add_argument("--lang", default="auto")
    parser.add_argument("--table-detection", default="true")
    parser.add_argument("--text-layer", default="true")
    parser.add_argument("--report")
    args = parser.parse_args()

    target = args.target.lower()
    table_detection = str(args.table_detection).lower() not in {"0", "false", "no", "off"}
    text_layer = str(args.text_layer).lower() not in {"0", "false", "no", "off"}
    report = make_report(args.input, target)
    report["tableDetectionEnabled"] = table_detection
    report["layoutPreservationEnabled"] = True

    try:
        if target == "xlsx":
            export_xlsx(args.input, args.output, report, args.lang, table_detection)
        elif target == "pptx":
            export_pptx(args.input, args.output, report, args.lang, text_layer)
        elif target == "html":
            export_html(args.input, args.output, report, args.lang, text_layer)
        else:
            raise RuntimeError(f"Unsupported target: {target}")
    except Exception as exc:
        report["warnings"].append(str(exc))
        write_report(args.report, report)
        raise
    write_report(args.report, report)


if __name__ == "__main__":
    main()
