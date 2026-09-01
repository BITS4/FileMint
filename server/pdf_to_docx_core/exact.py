"""High-accuracy exact-visual OCR-to-DOCX orchestration."""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Any

from .collection import collect_hosted_transcript_ocr_lines, collect_ocr_lines
from .config import FAST_HOSTED_OCR, quality_dpi
from .docx import table_runs
from .positioned import append_exact_visual_page, append_positioned_page
from .selection import (
    dense_table_scan_likely,
    exact_editable_lines,
    exact_editable_word_lines,
    merge_line_candidates,
    transcript_rebuild_likely,
)
from .transcript import detect_transcript_grid_geometry
from .transcript_docx import build_scanned_table_page
from .visual import segment_visual_layer


def ocr_to_docx_exact_visual(
    src: str,
    dst: str,
    lang: str,
    report: dict[str, Any],
    premium: bool = False,
    table_detection: bool = True,
    visible_text: bool = True,
    quality: str = "high",
    keep_visual_objects: bool = True,
) -> None:
    import fitz
    from docx import Document
    from docx.shared import Pt

    dpi = quality_dpi(quality, 300)
    pdf = fitz.open(src)
    out = Document()
    tmpdir = tempfile.mkdtemp(prefix="filemint-exact-ocr-")
    try:
        all_low_conf = 0
        pages_with_text = 0
        scanned_tables = 0
        colored_marks_kept = 0
        total_candidates = 0
        total_editable_boxes = 0
        total_editable_chars = 0
        total_skipped_low_conf = 0
        previous_page_reserved = False
        rebuilt_table_pages = 0
        visual_fragments_preserved = 0
        rules_rebuilt = 0
        exact_visual_fallback_pages = 0
        for page_index, page in enumerate(pdf):
            if page_index > 0 and not previous_page_reserved:
                out.add_page_break()
            section = out.sections[-1]
            section.page_width = Pt(page.rect.width)
            section.page_height = Pt(page.rect.height)
            section.top_margin = Pt(0)
            section.bottom_margin = Pt(0)
            section.left_margin = Pt(0)
            section.right_margin = Pt(0)

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
            if grid_geometry and FAST_HOSTED_OCR:
                primary_lines = collect_hosted_transcript_ocr_lines(
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
                primary_lines = collect_ocr_lines(
                    scan_png,
                    lang,
                    pix.width,
                    pix.height,
                    page.rect.width,
                    page.rect.height,
                    ["11"],
                    report,
                )
            if FAST_HOSTED_OCR and not primary_lines:
                append_exact_visual_page(
                    out,
                    page_index + 1,
                    scan_png,
                    [],
                    page.rect.width,
                    page.rect.height,
                    hidden_text=True,
                )
                exact_visual_fallback_pages += 1
                previous_page_reserved = True
                continue
            dense_scan = (
                premium
                and table_detection
                and (dense_table_scan_likely(primary_lines) or bool(grid_geometry))
            )
            dense_table = dense_scan and transcript_rebuild_likely(
                primary_lines, grid_geometry
            )
            generic_dense_scan = dense_scan and not dense_table
            if dense_table:
                scanned_tables = max(scanned_tables, 1)
                rebuilt_table_pages += 1
                lines = primary_lines
            if premium and not dense_table and not FAST_HOSTED_OCR:
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
                lines = merge_line_candidates(primary_lines, extra_lines, lang)
            else:
                if not dense_table:
                    lines = primary_lines
            if not dense_table:
                scanned_tables += len(table_runs(lines))
            if dense_table:
                editable_lines, stats = exact_editable_word_lines(
                    scan_png, lines, lang, premium=premium
                )
            else:
                editable_lines, stats = exact_editable_lines(
                    scan_png, lines, lang, premium=premium
                )
            colored_marks_kept += stats["skippedColoredMarks"]
            total_candidates += stats["ocrTextCandidates"]
            total_editable_boxes += stats["editableTextBoxes"]
            total_editable_chars += stats["editableCharacters"]
            total_skipped_low_conf += stats["skippedLowConfidence"]
            if editable_lines:
                pages_with_text += 1
            all_low_conf += sum(
                1 for line in lines for word in line.words if 0 <= word.conf < 55
            )
            if dense_table:
                build_scanned_table_page(
                    out, ocr_scan_png, lines, page.rect.width, page.rect.height, report
                )
                previous_page_reserved = False
            else:
                if visible_text and generic_dense_scan:
                    append_exact_visual_page(
                        out,
                        page_index + 1,
                        scan_png,
                        editable_lines,
                        page.rect.width,
                        page.rect.height,
                        hidden_text=True,
                    )
                    exact_visual_fallback_pages += 1
                    previous_page_reserved = True
                elif visible_text:
                    fragments, rules = segment_visual_layer(
                        scan_png,
                        tmpdir,
                        page_index,
                        editable_lines,
                        page.rect.width,
                        page.rect.height,
                    )
                    if not keep_visual_objects:
                        fragments = []
                    visual_fragments_preserved += len(fragments)
                    rules_rebuilt += len(rules)
                    append_positioned_page(
                        out,
                        page_index + 1,
                        editable_lines,
                        page.rect.width,
                        page.rect.height,
                        fragments,
                        rules,
                    )
                    previous_page_reserved = True
                else:
                    # Exact visual mode keeps the source scan untouched and
                    # stores OCR as hidden searchable/editable text.
                    visual_png = scan_png
                    append_exact_visual_page(
                        out,
                        page_index + 1,
                        visual_png,
                        editable_lines,
                        page.rect.width,
                        page.rect.height,
                        hidden_text=True,
                    )
                    previous_page_reserved = True

        report["editableTextDetected"] = pages_with_text > 0
        report["tablesDetected"] = max(
            int(report.get("tablesDetected", 0)), scanned_tables
        )
        report["lowConfidenceOcrAreas"] = all_low_conf
        report["editableTextBoxes"] = total_editable_boxes
        report["editableCharacters"] = total_editable_chars
        report["ocrTextCandidates"] = total_candidates
        report["textCoverageEstimate"] = round(
            (total_editable_boxes / max(1, total_candidates)) * 100
        )
        report["visualObjectsPreserved"] = report.get("pagesConverted", 0)
        report["hiddenTextLayer"] = (pages_with_text > 0 and not visible_text) or (
            exact_visual_fallback_pages > 0 and pages_with_text > 0
        )
        report["visibleEditableTextLayer"] = (
            pages_with_text > exact_visual_fallback_pages and visible_text
        )
        report["tablesRebuiltAsWord"] = (
            rebuilt_table_pages if premium and table_detection else 0
        )
        report["visualFragmentsPreserved"] = visual_fragments_preserved
        report["rulesRebuiltAsWord"] = rules_rebuilt
        report["nonEditableVisualFallback"] = (
            bool(report.get("hostedOcrTimedOut"))
            and total_editable_chars == 0
            and rebuilt_table_pages == 0
            and exact_visual_fallback_pages > 0
        )
        if not report["nonEditableVisualFallback"]:
            fallback_warning = (
                "Hosted OCR timed out before editable text reconstruction could finish. "
                "FileMint returned a visual DOCX fallback instead of failing."
            )
            report["warnings"] = [
                warning
                for warning in report.get("warnings", [])
                if warning != fallback_warning
            ]
            if report.get("hostedOcrTimedOut"):
                report["warnings"].append(
                    "Some hosted OCR regions exceeded the fast server limit; FileMint rebuilt the editable parts it could detect and preserved uncertain content visually."
                )
        if premium:
            if report["nonEditableVisualFallback"]:
                report["notes"].append(
                    "Hosted OCR did not finish within the server limit, so FileMint returned a valid visual DOCX fallback. Use a stronger backend instance for fully editable OCR on this scan."
                )
            elif rebuilt_table_pages:
                report["notes"].append(
                    "Premium table scan mode rebuilt detected transcript/table regions as editable Word table cells."
                )
            elif visible_text:
                report["notes"].append(
                    f"Premium OCR Editable Mode rebuilt scan text as visible editable Word text boxes, recreated {rules_rebuilt} simple line(s) as Word shapes, and preserved {visual_fragments_preserved} non-convertible visual fragment(s) as positioned images."
                )
            else:
                report["notes"].append(
                    "Premium Exact Visual Mode preserved each scanned page as the original image and added OCR as a hidden editable/searchable text layer to avoid visual OCR artifacts."
                )
        else:
            if visible_text:
                report["notes"].append(
                    "Scanned PDF rebuilt OCR text as visible editable Word text boxes while preserving non-text visuals as page artwork."
                )
            else:
                report["notes"].append(
                    "Scanned PDF preserved each original page image and added OCR as a hidden editable/searchable text layer at original page coordinates."
                )
        if all_low_conf:
            report["warnings"].append(
                "Some low-confidence OCR regions were kept as image content to preserve seals, signatures or unclear text."
            )
        if exact_visual_fallback_pages:
            if report.get("hostedOcrTimedOut") and pages_with_text == 0:
                report["warnings"].append(
                    f"{exact_visual_fallback_pages} scanned page(s) were preserved as exact page images because hosted OCR timed out."
                )
            else:
                report["warnings"].append(
                    f"{exact_visual_fallback_pages} dense non-template scanned page(s) were preserved as exact page images with OCR text hidden behind them to avoid visual corruption."
                )
        if total_skipped_low_conf:
            report["warnings"].append(
                f"{total_skipped_low_conf} OCR text candidates were too uncertain to rebuild as editable text."
            )
        if colored_marks_kept:
            report["warnings"].append(
                "Colored stamp/signature regions were kept visual-only to avoid OCR artifacts over official marks."
            )
        out.save(dst)
    finally:
        pdf.close()
        shutil.rmtree(tmpdir, ignore_errors=True)
