"""OCR collection across full pages, regions, and hosted workloads."""

from __future__ import annotations

import os
import tempfile
from typing import Any

from .config import FAST_HOSTED_OCR
from .docx import line_text_signal
from .models import LineBox, WordBox
from .ocr import ocr_language_candidates, parse_tsv, run_tesseract_tsv, score_ocr_lines
from .selection import merge_line_candidates


def collect_ocr_lines(
    image: str,
    lang: str,
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
    psm_modes: list[str],
    report: dict[str, Any],
) -> list[LineBox]:
    collected: list[LineBox] = []
    report.setdefault("ocrPasses", [])
    candidates = ocr_language_candidates(lang)
    for psm in psm_modes:
        best_lang = ""
        best_score = -10000.0
        parsed: list[LineBox] = []
        errors: list[str] = []
        pass_notes: list[str] = []
        for candidate in candidates:
            try:
                tsv = run_tesseract_tsv(image, candidate, psm=psm)
                candidate_lines = parse_tsv(
                    tsv, page_width_px, page_height_px, page_width_pt, page_height_pt
                )
                score = score_ocr_lines(candidate_lines, candidate)
                pass_notes.append(f"{candidate}:{len(candidate_lines)}@{score:.1f}")
                if score > best_score:
                    best_lang = candidate
                    best_score = score
                    parsed = candidate_lines
            except Exception as e:
                errors.append(f"{candidate}: {e}")
        if not best_lang:
            if FAST_HOSTED_OCR:
                report["hostedOcrTimedOut"] = True
                warning = (
                    "Hosted OCR timed out before editable text reconstruction could finish. "
                    "FileMint returned a visual DOCX fallback instead of failing."
                )
                if warning not in report.setdefault("warnings", []):
                    report["warnings"].append(warning)
                report["ocrPasses"].append(f"psm-{psm}/timeout [{'; '.join(errors)}]")
                continue
            raise RuntimeError("; ".join(errors) or "Tesseract OCR failed.")
        report["ocrPasses"].append(
            f"psm-{psm}/{best_lang}:{len(parsed)} [{'; '.join(pass_notes)}]"
        )
        for line in parsed:
            if not line_text_signal(line):
                continue
            collected = merge_line_candidates(collected, [line], lang)
    return sorted(collected, key=lambda l: (l.top, l.left))


def offset_ocr_lines(
    lines: list[LineBox],
    dx: float,
    dy: float,
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
) -> list[LineBox]:
    shifted: list[LineBox] = []
    for line in lines:
        words = [
            WordBox(
                text=word.text,
                left=word.left + dx,
                top=word.top + dy,
                width=word.width,
                height=word.height,
                conf=word.conf,
                block=word.block,
                par=word.par,
                line=word.line,
            )
            for word in line.words
        ]
        shifted.append(
            LineBox(
                text=line.text,
                words=words,
                left=line.left + dx,
                top=line.top + dy,
                width=line.width,
                height=line.height,
                conf=line.conf,
                page_width_px=page_width_px,
                page_height_px=page_height_px,
                page_width_pt=page_width_pt,
                page_height_pt=page_height_pt,
                segments=[
                    (left + dx, right + dx, text) for left, right, text in line.segments
                ],
            )
        )
    return shifted


def collect_ocr_lines_region(
    image: str,
    lang: str,
    bbox: tuple[int, int, int, int],
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
    psm_modes: list[str],
    report: dict[str, Any],
    label: str,
) -> list[LineBox]:
    from PIL import Image, ImageFilter, ImageOps

    left, top, right, bottom = bbox
    left = max(0, min(int(page_width_px) - 1, left))
    top = max(0, min(int(page_height_px) - 1, top))
    right = max(left + 1, min(int(page_width_px), right))
    bottom = max(top + 1, min(int(page_height_px), bottom))

    with Image.open(image).convert("RGB") as img:
        crop = img.crop((left, top, right, bottom))
        if FAST_HOSTED_OCR:
            crop = ImageOps.autocontrast(crop.convert("L")).filter(ImageFilter.SHARPEN)
        tmp = tempfile.NamedTemporaryFile(
            prefix=f"filemint-ocr-{label}-", suffix=".png", delete=False
        )
        tmp.close()
        crop.save(tmp.name)

    try:
        previous_timeout = os.environ.get("FILEMINT_TESSERACT_TIMEOUT_SEC")
        if FAST_HOSTED_OCR:
            os.environ["FILEMINT_TESSERACT_TIMEOUT_SEC"] = previous_timeout or "24"
        lines = collect_ocr_lines(
            tmp.name,
            lang,
            right - left,
            bottom - top,
            page_width_pt * ((right - left) / max(1.0, page_width_px)),
            page_height_pt * ((bottom - top) / max(1.0, page_height_px)),
            psm_modes,
            report,
        )
        return offset_ocr_lines(
            lines,
            left,
            top,
            page_width_px,
            page_height_px,
            page_width_pt,
            page_height_pt,
        )
    finally:
        if FAST_HOSTED_OCR:
            if previous_timeout is None:
                os.environ.pop("FILEMINT_TESSERACT_TIMEOUT_SEC", None)
            else:
                os.environ["FILEMINT_TESSERACT_TIMEOUT_SEC"] = previous_timeout
        try:
            os.remove(tmp.name)
        except Exception:
            pass


def collect_hosted_transcript_ocr_lines(
    image: str,
    lang: str,
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
    grid_geometry: dict[str, Any] | None,
    report: dict[str, Any],
) -> list[LineBox]:
    if not FAST_HOSTED_OCR:
        return []
    if not grid_geometry:
        return []

    x_positions = grid_geometry.get("xPositionsPx") or []
    y_positions = grid_geometry.get("yPositionsPx") or []
    if len(x_positions) < 6 or len(y_positions) < 8:
        return []

    margin_x = max(6, int(page_width_px * 0.012))
    margin_y = max(6, int(page_height_px * 0.010))
    regions: list[tuple[str, tuple[int, int, int, int], list[str]]] = [
        (
            "header",
            (
                int(page_width_px * 0.04),
                int(page_height_px * 0.03),
                int(page_width_px * 0.96),
                int(max(page_height_px * 0.30, y_positions[0] - margin_y)),
            ),
            ["6"],
        )
    ]
    top = int(max(0, y_positions[0] - margin_y))
    bottom = int(
        min(page_height_px, max(y_positions[-1] + margin_y, page_height_px * 0.89))
    )
    for idx in range(min(5, len(x_positions) - 1)):
        left = int(x_positions[idx] - margin_x)
        right = int(x_positions[idx + 1] + margin_x)
        regions.append((f"table-col-{idx + 1}", (left, top, right, bottom), ["6"]))

    collected: list[LineBox] = []
    for label, bbox, modes in regions:
        lines = collect_ocr_lines_region(
            image,
            lang,
            bbox,
            page_width_px,
            page_height_px,
            page_width_pt,
            page_height_pt,
            modes,
            report,
            label,
        )
        collected = merge_line_candidates(collected, lines, lang)

    if collected:
        report["notes"].append(
            "Hosted OCR used a fast region-based table pass instead of slow full-page OCR."
        )
    return sorted(collected, key=lambda line: (line.top, line.left))
