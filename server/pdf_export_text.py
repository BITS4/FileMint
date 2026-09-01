"""Positioned text extraction and OCR helpers for PDF exports."""

from __future__ import annotations

import os
import statistics
from typing import Any

import fitz

from pdf_export_model import TextLine, TextWord, clean_text
from pdf_to_docx import parse_tsv, resolve_ocr_language, run_tesseract_tsv


def render_page_png(page: fitz.Page, dst: str, dpi: int = 160) -> tuple[int, int]:
    """Render a PDF page to a PNG and return its pixel dimensions."""
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    pix.save(dst)
    return pix.width, pix.height


def join_positioned_words(words: list[TextWord]) -> str:
    """Join words from one visual row while approximating meaningful gaps."""
    if not words:
        return ""
    ordered = sorted(words, key=lambda word: word.x0)
    heights = [max(1.0, word.y1 - word.y0) for word in ordered]
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
    """Read and normalize positioned words from a page's native text layer."""
    out: list[TextWord] = []
    for item in page.get_text("words", sort=True) or []:
        x0, y0, x1, y1, text = item[:5]
        text = clean_text(text)
        if text:
            out.append(
                TextWord(
                    text=text,
                    x0=float(x0),
                    y0=float(y0),
                    x1=float(x1),
                    y1=float(y1),
                )
            )
    return out


def words_to_lines(words: list[TextWord]) -> list[TextLine]:
    """Group positioned words into ordered visual lines."""
    if not words:
        return []
    ordered = sorted(words, key=lambda word: (word.y0, word.x0))
    heights = [max(1.0, word.y1 - word.y0) for word in ordered]
    tolerance = max(3.0, (statistics.median(heights) if heights else 10.0) * 0.55)
    rows: list[list[TextWord]] = []
    centers: list[float] = []
    for word in ordered:
        center_y = (word.y0 + word.y1) / 2.0
        best = None
        best_dist = float("inf")
        for index, center in enumerate(centers):
            distance = abs(center_y - center)
            if distance < best_dist:
                best = index
                best_dist = distance
        if best is None or best_dist > tolerance:
            rows.append([word])
            centers.append(center_y)
        else:
            rows[best].append(word)
            centers[best] = statistics.mean(
                [(row_word.y0 + row_word.y1) / 2.0 for row_word in rows[best]]
            )

    lines: list[TextLine] = []
    for row in rows:
        row = sorted(row, key=lambda word: word.x0)
        text = join_positioned_words(row)
        if not text:
            continue
        x0 = min(word.x0 for word in row)
        y0 = min(word.y0 for word in row)
        x1 = max(word.x1 for word in row)
        y1 = max(word.y1 for word in row)
        confidences = [word.conf for word in row if word.conf >= 0]
        lines.append(
            TextLine(
                text=text,
                x0=x0,
                y0=y0,
                x1=x1,
                y1=y1,
                font_size=max(6.0, min(32.0, (y1 - y0) * 0.78)),
                conf=statistics.mean(confidences) if confidences else 100.0,
            )
        )
    return sorted(lines, key=lambda line: (line.y0, line.x0))


def ocr_words_for_page(
    page: fitz.Page,
    tmpdir: str,
    lang: str,
    report: dict[str, Any],
) -> list[TextWord]:
    """Render and OCR a page, converting pixel coordinates back to PDF points."""
    image = os.path.join(tmpdir, f"ocr-page-{page.number + 1}.png")
    pixel_width, pixel_height = render_page_png(page, image, dpi=220)
    tsv = run_tesseract_tsv(image, lang, psm="11")
    lines = parse_tsv(tsv, pixel_width, pixel_height, page.rect.width, page.rect.height)
    out: list[TextWord] = []
    for line in lines:
        for word in line.words:
            x0 = word.left / pixel_width * page.rect.width
            y0 = word.top / pixel_height * page.rect.height
            x1 = (word.left + word.width) / pixel_width * page.rect.width
            y1 = (word.top + word.height) / pixel_height * page.rect.height
            text = clean_text(word.text)
            if text:
                out.append(
                    TextWord(
                        text=text,
                        x0=x0,
                        y0=y0,
                        x1=x1,
                        y1=y1,
                        conf=word.conf,
                    )
                )
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
    """Return native words or use OCR only when the native layer is empty."""
    words = native_words(page)
    if words or not allow_ocr or not lang:
        return words
    try:
        return ocr_words_for_page(page, tmpdir, lang, report)
    except Exception as exc:
        report["warnings"].append(
            f"OCR text layer failed on page {page.number + 1}: {exc}"
        )
        return []


def page_text_lines(
    page: fitz.Page,
    tmpdir: str,
    lang: str | None,
    report: dict[str, Any],
    allow_ocr: bool,
) -> list[TextLine]:
    """Return visual lines for a native or OCR text layer."""
    return words_to_lines(page_text_words(page, tmpdir, lang, report, allow_ocr))


def update_text_metrics(report: dict[str, Any], lines: list[TextLine]) -> None:
    """Merge extracted-line counts and coverage estimates into an export report."""
    characters = sum(len(line.text) for line in lines)
    report["editableTextBoxes"] += len(lines)
    report["editableCharacters"] += characters
    if characters > 0:
        report["editableTextDetected"] = True
    candidates = max(1, int(report.get("ocrTextCandidates") or 0))
    if report.get("pdfType") == "scanned" and report.get("ocrTextCandidates"):
        report["textCoverageEstimate"] = min(100, round(characters / candidates * 8))
    elif characters:
        report["textCoverageEstimate"] = 100


def maybe_resolve_ocr(
    src: str,
    requested_lang: str,
    text_layer: bool,
    report: dict[str, Any],
) -> str | None:
    """Resolve OCR language only for scanned/mixed PDFs with text enabled."""
    if not text_layer:
        return None
    if report.get("pdfType") not in {"scanned", "mixed"}:
        return None
    try:
        return resolve_ocr_language(requested_lang, report)
    except Exception as exc:
        report["warnings"].append(str(exc))
        return None
