"""Output validation, quality statistics, repair, and JSON reports."""

from __future__ import annotations

import json
import os
import re
import zipfile
from typing import Any
from xml.sax.saxutils import unescape

from .exact import ocr_to_docx_exact_visual
from .image import ocr_to_docx_layout
from .runtime import resolve_ocr_language


def ensure_output(path: str) -> None:
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise SystemExit("Conversion produced no output.")


def docx_output_stats(path: str) -> dict[str, Any]:
    stats: dict[str, Any] = {
        "outputTextRuns": 0,
        "outputEditableCharacters": 0,
        "outputImages": 0,
        "outputTables": 0,
    }
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return stats

    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            xml_names = [
                name
                for name in names
                if name == "word/document.xml"
                or re.match(r"word/(header|footer|footnotes|endnotes)\d*\.xml$", name)
            ]
            for name in xml_names:
                xml = zf.read(name).decode("utf-8", errors="ignore")
                pieces = re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", xml, flags=re.S)
                stats["outputTextRuns"] += len(pieces)
                stats["outputEditableCharacters"] += sum(
                    len(unescape(piece)) for piece in pieces
                )
                stats["outputTables"] += xml.count("<w:tbl")
            stats["outputImages"] = sum(
                1 for name in names if name.startswith("word/media/")
            )
    except Exception:
        return stats
    return stats


def merge_output_stats(report: dict[str, Any], path: str) -> dict[str, Any]:
    stats = docx_output_stats(path)
    report.update(stats)
    return stats


def repair_empty_editable_output(
    src: str,
    dst: str,
    lang_request: str,
    table_detection: bool,
    report: dict[str, Any],
    quality: str,
    keep_visual_objects: bool,
) -> None:
    report["warnings"].append(
        "The first DOCX pass contained no editable text, so FileMint retried with OCR Editable reconstruction instead of returning an image-only Word file."
    )
    lang = resolve_ocr_language(lang_request, report)
    try:
        ocr_to_docx_exact_visual(
            src,
            dst,
            lang,
            report,
            premium=True,
            table_detection=table_detection,
            visible_text=True,
            quality=quality,
            keep_visual_objects=keep_visual_objects,
        )
        report["resolvedMode"] = "ocr-repair-editable-visual"
    except Exception as e:
        report["warnings"].append(
            f"OCR repair with visual placement failed ({e}); retrying text-only OCR reconstruction."
        )
        ocr_to_docx_layout(src, dst, lang, table_detection, report, quality=quality)
        report["resolvedMode"] = "ocr-repair-text-flow"


def write_report(path: str | None, report: dict[str, Any]) -> None:
    if not path:
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=True, indent=2)
