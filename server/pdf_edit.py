#!/usr/bin/env python3
"""PDF edit helpers for FileMint.

The browser/native app can draw normal vector edits with pdf-lib. Redaction is
different: it must remove underlying text and hidden content, so this helper
uses PyMuPDF's real redaction pipeline.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import fitz  # PyMuPDF


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    clean = (value or "#000000").strip()
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", clean)
    if not match:
        clean = "000000"
    else:
        clean = match.group(1)
    return (
        int(clean[0:2], 16) / 255,
        int(clean[2:4], 16) / 255,
        int(clean[4:6], 16) / 255,
    )


def redact(
    input_path: Path, output_path: Path, areas_json: str, color: str, label: str
) -> None:
    try:
        areas = json.loads(areas_json or "[]")
    except json.JSONDecodeError:
        fixed = (areas_json or "[]").replace('\\"', '"')
        fixed = re.sub(r"([{\[,]\s*)([A-Za-z_][\w-]*)(\s*:)", r'\1"\2"\3', fixed)
        areas = json.loads(fixed)
    fill = hex_to_rgb(color)
    doc = fitz.open(input_path)
    try:
        doc.set_metadata({})
    except Exception:
        pass

    for item in areas:
        page_index = int(item.get("page", 0))
        if page_index < 0 or page_index >= doc.page_count:
            continue
        page = doc[page_index]
        rect = page.rect
        x = float(item.get("x", 0.22)) * rect.width
        y = float(item.get("y", 0.42)) * rect.height
        w = float(item.get("width", 0.48)) * rect.width
        h = float(item.get("height", 0.07)) * rect.height
        box = fitz.Rect(x, y, x + w, y + h)
        page.add_redact_annot(
            box,
            text=label or "",
            fill=fill,
            text_color=(1, 1, 1),
            fontsize=8,
            align=fitz.TEXT_ALIGN_CENTER,
        )
        try:
            page.apply_redactions(images=getattr(fitz, "PDF_REDACT_IMAGE_PIXELS", 2))
        except TypeError:
            page.apply_redactions()

    doc.save(output_path, garbage=4, deflate=True, clean=True)
    doc.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["redact"], required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--areas-json", default="[]")
    parser.add_argument("--color", default="#000000")
    parser.add_argument("--label", default="Redacted")
    args = parser.parse_args()

    if args.task == "redact":
        redact(
            Path(args.input), Path(args.output), args.areas_json, args.color, args.label
        )


if __name__ == "__main__":
    main()
