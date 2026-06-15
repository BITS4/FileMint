#!/usr/bin/env python3
"""PDF utility exports for FileMint: render pages and extract text."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import zipfile
from typing import Any

import fitz

from pdf_to_docx import inspect_pdf, parse_tsv, resolve_ocr_language, run_tesseract_tsv


def make_report(src: str, mode: str) -> dict[str, Any]:
    info = inspect_pdf(src)
    return {
        "engine": "filemint-pdf-utility",
        "requestedMode": mode,
        "resolvedMode": mode,
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
        "tableDetectionEnabled": False,
        "layoutPreservationEnabled": True,
        "nonEditableVisualFallback": False,
        "warnings": [],
        "notes": [],
    }


def write_report(path: str | None, report: dict[str, Any]) -> None:
    if not path:
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


def render_pages(src: str, dst_zip: str, fmt: str, dpi: int, report: dict[str, Any]) -> None:
    doc = fitz.open(src)
    try:
      with tempfile.TemporaryDirectory() as tmpdir, zipfile.ZipFile(dst_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        zoom = max(72, min(360, dpi)) / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            name = f"page-{page.number + 1:03d}.{fmt}"
            path = os.path.join(tmpdir, name)
            if fmt == "jpg":
                pix.save(path, jpg_quality=92)
            else:
                pix.save(path)
            zf.write(path, name)
        report["notes"].append(f"Rendered {len(doc)} page(s) to {fmt.upper()} images.")
    finally:
        doc.close()


def ocr_page_text(page: fitz.Page, tmpdir: str, lang: str, report: dict[str, Any]) -> str:
    dpi = 220
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    image = os.path.join(tmpdir, f"page-{page.number + 1}.png")
    pix.save(image)
    tsv = run_tesseract_tsv(image, lang, psm="6")
    lines = parse_tsv(tsv, pix.width, pix.height, page.rect.width, page.rect.height)
    report["ocrTextCandidates"] += sum(len(line.words) for line in lines)
    if "psm-6" not in report["ocrPasses"]:
        report["ocrPasses"].append("psm-6")
    for line in lines:
        if line.conf >= 0 and line.conf < 55:
            report["lowConfidenceOcrAreas"] += 1
    return "\n".join(line.text for line in lines if line.text.strip())


def extract_text(src: str, dst: str, lang: str, report: dict[str, Any]) -> None:
    doc = fitz.open(src)
    chunks: list[str] = []
    try:
        for page in doc:
            text = (page.get_text("text", sort=True) or "").strip()
            if text:
                chunks.append(text)
            else:
                chunks.append("")

        native = "\n\n".join(chunks).strip()
        if native:
            report["editableTextDetected"] = True
            report["editableTextBoxes"] = len([c for c in chunks if c.strip()])
            report["editableCharacters"] = len(native)
            report["textCoverageEstimate"] = 100
            report["notes"].append("Extracted native selectable PDF text.")
            with open(dst, "w", encoding="utf-8") as f:
                f.write(native)
            return

        ocr_lang = resolve_ocr_language(lang, report)
        ocr_chunks: list[str] = []
        with tempfile.TemporaryDirectory() as tmpdir:
            for page in doc:
                ocr_chunks.append(ocr_page_text(page, tmpdir, ocr_lang, report))
        text = "\n\n".join(ocr_chunks).strip()
        report["editableTextDetected"] = bool(text)
        report["editableTextBoxes"] = len([c for c in ocr_chunks if c.strip()])
        report["editableCharacters"] = len(text)
        report["textCoverageEstimate"] = 100 if text else 0
        report["notes"].append("Native text was unavailable, so OCR text extraction was used.")
        with open(dst, "w", encoding="utf-8") as f:
            f.write(text)
    finally:
        doc.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--task", required=True, choices=["images", "text"])
    parser.add_argument("--format", default="png", choices=["png", "jpg"])
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--lang", default="auto")
    parser.add_argument("--report")
    args = parser.parse_args()

    report = make_report(args.input, f"pdf-{args.task}")
    try:
        if args.task == "images":
            render_pages(args.input, args.output, args.format, args.dpi, report)
        else:
            extract_text(args.input, args.output, args.lang, report)
    except Exception as exc:
        report["warnings"].append(str(exc))
        write_report(args.report, report)
        raise
    write_report(args.report, report)


if __name__ == "__main__":
    main()
