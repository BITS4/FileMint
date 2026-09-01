"""Scanned PDF text-layer conversion pipeline."""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Any

from .collection import collect_hosted_transcript_ocr_lines, collect_ocr_lines
from .config import FAST_HOSTED_OCR, quality_dpi
from .docx import line_text_signal
from .models import LineBox
from .positioned import append_linebox_flow_paragraph, native_pdf_line_boxes
from .selection import (
    dense_table_scan_likely,
    exact_editable_lines,
    merge_line_candidates,
    transcript_rebuild_likely,
)
from .transcript import detect_transcript_grid_geometry
from .transcript_docx import build_scanned_table_page


def to_docx_scan_text_layer(
    src: str,
    dst: str,
    lang: str | None,
    report: dict[str, Any],
    premium: bool = False,
    table_detection: bool = True,
    quality: str = "high",
) -> None:
    import fitz
    from docx import Document
    from docx.shared import Pt

    dpi = quality_dpi(quality, 300)
    pdf = fitz.open(src)
    out = Document()
    tmpdir = tempfile.mkdtemp(prefix="filemint-text-layer-scan-")
    try:
        pages_with_text = 0
        all_low_conf = 0
        total_candidates = 0
        total_editable_boxes = 0
        total_editable_chars = 0
        total_skipped_low_conf = 0
        native_pages = 0
        ocr_pages = 0
        scanned_tables = 0

        for page_index, page in enumerate(pdf):
            if page_index > 0:
                out.add_page_break()
            section = out.sections[-1]
            section.page_width = Pt(page.rect.width)
            section.page_height = Pt(page.rect.height)
            section.top_margin = Pt(12)
            section.bottom_margin = Pt(8)
            section.left_margin = Pt(54)
            section.right_margin = Pt(42)

            pix = page.get_pixmap(dpi=dpi, alpha=False)
            scan_png = os.path.join(tmpdir, f"page-{page_index + 1}.png")
            pix.save(scan_png)
            ocr_scan_png = scan_png
            ocr_width = pix.width
            ocr_height = pix.height
            if premium and table_detection and FAST_HOSTED_OCR:
                try:
                    ocr_pix = page.get_pixmap(dpi=120, alpha=False)
                    ocr_scan_png = os.path.join(
                        tmpdir, f"page-{page_index + 1}-ocr.png"
                    )
                    ocr_pix.save(ocr_scan_png)
                    ocr_width = ocr_pix.width
                    ocr_height = ocr_pix.height
                except Exception:
                    ocr_scan_png = scan_png
                    ocr_width = pix.width
                    ocr_height = pix.height
            grid_geometry: dict[str, Any] | None = None
            if premium and table_detection and FAST_HOSTED_OCR:
                try:
                    from PIL import Image

                    with Image.open(ocr_scan_png).convert("RGB") as scan_img:
                        grid_geometry = detect_transcript_grid_geometry(
                            scan_img, page.rect.width, page.rect.height
                        )
                except Exception:
                    grid_geometry = None

            native_lines = native_pdf_line_boxes(page, pix.width, pix.height)
            native_chars = sum(len(line.text) for line in native_lines)
            lines = native_lines
            source = "native-text-layer"
            primary_ocr_lines: list[LineBox] = []

            if lang and (native_chars < 200 or (premium and table_detection)):
                if grid_geometry and FAST_HOSTED_OCR:
                    primary_ocr_lines = collect_hosted_transcript_ocr_lines(
                        ocr_scan_png,
                        lang,
                        ocr_width,
                        ocr_height,
                        page.rect.width,
                        page.rect.height,
                        grid_geometry,
                        report,
                    )
                else:
                    primary_ocr_lines = collect_ocr_lines(
                        scan_png,
                        lang,
                        pix.width,
                        pix.height,
                        page.rect.width,
                        page.rect.height,
                        ["11"],
                        report,
                    )
                transcript_table = (
                    table_detection
                    and premium
                    and transcript_rebuild_likely(primary_ocr_lines, grid_geometry)
                )
                if transcript_table and (
                    dense_table_scan_likely(primary_ocr_lines) or grid_geometry
                ):
                    scanned_tables += 1
                    build_scanned_table_page(
                        out,
                        ocr_scan_png,
                        primary_ocr_lines,
                        page.rect.width,
                        page.rect.height,
                        report,
                    )
                    continue
                if native_chars < 200 and primary_ocr_lines:
                    lines = primary_ocr_lines
                    source = "ocr-fallback"
                    if premium and not FAST_HOSTED_OCR:
                        extra_lines = collect_ocr_lines(
                            scan_png,
                            lang,
                            pix.width,
                            pix.height,
                            page.rect.width,
                            page.rect.height,
                            ["6"],
                            report,
                        )
                        lines = merge_line_candidates(lines, extra_lines, lang)

            if source == "native-text-layer":
                native_pages += 1
                editable_lines = [line for line in lines if line_text_signal(line)]
                stats = {
                    "ocrTextCandidates": len(editable_lines),
                    "editableTextBoxes": len(editable_lines),
                    "editableCharacters": sum(
                        len(line.text) for line in editable_lines
                    ),
                    "skippedLowConfidence": 0,
                }
            else:
                ocr_pages += 1
                all_low_conf += sum(
                    1 for line in lines for word in line.words if 0 <= word.conf < 55
                )
                editable_lines, stats = exact_editable_lines(
                    scan_png, lines, lang or "native", premium=True
                )

            total_candidates += stats["ocrTextCandidates"]
            total_editable_boxes += stats["editableTextBoxes"]
            total_editable_chars += stats["editableCharacters"]
            total_skipped_low_conf += stats["skippedLowConfidence"]
            if editable_lines:
                pages_with_text += 1

            prev_bottom: float | None = None
            for line in editable_lines:
                append_linebox_flow_paragraph(out, line, prev_bottom, 54.0, 12.0)
                scale_y = line.page_height_pt / max(1.0, line.page_height_px)
                prev_bottom = (line.top + line.height) * scale_y

        report["resolvedMode"] = (
            "premium-scan-text-flow" if premium else "scan-text-flow"
        )
        report["editableTextDetected"] = pages_with_text > 0
        report["lowConfidenceOcrAreas"] = all_low_conf
        report["editableTextBoxes"] = total_editable_boxes
        report["editableCharacters"] = total_editable_chars
        report["ocrTextCandidates"] = total_candidates
        report["textCoverageEstimate"] = round(
            (total_editable_boxes / max(1, total_candidates)) * 100
        )
        report["visualObjectsPreserved"] = report.get("pagesConverted", 0)
        report["hiddenTextLayer"] = False
        report["visibleEditableTextLayer"] = pages_with_text > 0
        report["tablesRebuiltAsWord"] = scanned_tables
        report["nonEditableVisualFallback"] = False
        report["notes"].append(
            f"Detected full-page scanned images with a text layer. Rebuilt {native_pages} page(s) from native PDF text coordinates and {ocr_pages} weak page(s) with OCR fallback as normal editable Word paragraphs."
        )
        if total_skipped_low_conf:
            report["warnings"].append(
                f"{total_skipped_low_conf} OCR text candidates were too uncertain to rebuild as editable text."
            )
        out.save(dst)
    finally:
        pdf.close()
        shutil.rmtree(tmpdir, ignore_errors=True)
