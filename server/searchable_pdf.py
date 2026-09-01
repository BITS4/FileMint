#!/usr/bin/env python3
"""Create a searchable PDF with validation and a FileMint quality report."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from pdf_to_docx import (
    find_tesseract,
    inspect_pdf,
    resolve_ocr_language,
    tessdata_dir_for_lang,
)


def truthy(value: str | bool | None, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def text_stats(path: str) -> dict[str, Any]:
    import fitz

    doc = fitz.open(path)
    try:
        page_chars: list[int] = []
        page_words: list[int] = []
        all_text: list[str] = []
        for page in doc:
            text = page.get_text("text") or ""
            words = page.get_text("words") or []
            clean = text.strip()
            page_chars.append(len(clean))
            page_words.append(len(words))
            if clean:
                all_text.append(clean)
        return {
            "pages": doc.page_count,
            "characters": sum(page_chars),
            "words": sum(page_words),
            "textPages": sum(1 for n in page_chars if n >= 8),
            "pageCharacters": page_chars,
            "sample": "\n".join(all_text).strip()[:1000],
        }
    finally:
        doc.close()


def report_header() -> dict[str, Any]:
    return {
        "engine": "ocrmypdf",
        "requestedMode": "searchable",
        "resolvedMode": "searchable-ocr-layer",
        "pdfType": "unknown",
        "pagesConverted": 0,
        "editableTextDetected": False,
        "editableTextBoxes": 0,
        "editableCharacters": 0,
        "outputEditableCharacters": 0,
        "outputTextRuns": 0,
        "ocrTextCandidates": 0,
        "textCoverageEstimate": 0,
        "hiddenTextLayer": False,
        "visibleEditableTextLayer": False,
        "ocrPasses": [],
        "ocrLanguage": None,
        "warnings": [],
        "notes": [],
    }


def find_ocrmypdf(explicit: str | None = None) -> str | None:
    candidates = [explicit] if explicit else []
    candidates.extend(["ocrmypdf", "ocrmypdf.exe"])
    for candidate in candidates:
        if not candidate:
            continue
        if os.path.isabs(candidate) and os.path.exists(candidate):
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    return None


def run_ocrmypdf(
    ocrmypdf: str,
    src: str,
    dst: str,
    sidecar: str,
    lang: str,
    input_info: dict[str, Any],
    force: bool,
    deskew: bool,
    rotate_pages: bool,
) -> tuple[str, str]:
    command = [
        ocrmypdf,
        "-l",
        lang,
        "--sidecar",
        sidecar,
        "--output-type",
        "pdf",
        "--optimize",
        "0",
    ]
    if deskew:
        command.append("--deskew")

    input_has_text = int(input_info.get("textCharacters") or 0) >= 25
    image_backed = int(input_info.get("imageBackedPages") or 0) > 0
    if force or not input_has_text or image_backed:
        command.append("--force-ocr")
    else:
        command.append("--skip-text")
    command.extend([src, dst])

    env = os.environ.copy()
    tess = find_tesseract()
    merged_tessdata: str | None = None
    if tess:
        env["PATH"] = str(Path(tess).parent) + os.pathsep + env.get("PATH", "")
    tessdata_dir = tessdata_dir_for_lang(lang)
    if tessdata_dir:
        system_tessdata = Path(tess).parent / "tessdata" if tess else None
        merged_tessdata = tempfile.mkdtemp(prefix="filemint-tessdata-")
        merged_path = Path(merged_tessdata)
        if system_tessdata and system_tessdata.exists():
            for child in system_tessdata.iterdir():
                target = merged_path / child.name
                try:
                    if child.is_dir():
                        shutil.copytree(child, target, dirs_exist_ok=True)
                    elif child.suffix == ".traineddata" or child.name in {"pdf.ttf"}:
                        shutil.copy2(child, target)
                except Exception:
                    pass
        for child in Path(tessdata_dir).glob("*.traineddata"):
            shutil.copy2(child, merged_path / child.name)
        env["TESSDATA_PREFIX"] = merged_tessdata
    osd_available = (
        os.path.exists(os.path.join(tessdata_dir, "osd.traineddata"))
        if tessdata_dir
        else bool(
            tess
            and os.path.exists(
                os.path.join(str(Path(tess).parent), "tessdata", "osd.traineddata")
            )
        )
    )
    if rotate_pages and osd_available:
        command.insert(-2, "--rotate-pages")

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            env=env,
        )
        return result.stdout or "", result.stderr or ""
    finally:
        if merged_tessdata:
            shutil.rmtree(merged_tessdata, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--lang", default="auto")
    parser.add_argument("--force", default="auto")
    parser.add_argument("--deskew", default="true")
    parser.add_argument("--rotate-pages", default="true")
    parser.add_argument("--ocrmypdf", default="")
    parser.add_argument("--report", default="")
    args = parser.parse_args()

    report = report_header()
    tmpdir = tempfile.mkdtemp(prefix="filemint-searchable-")
    sidecar = os.path.join(tmpdir, "sidecar.txt")

    try:
        input_info = inspect_pdf(args.input)
        input_stats = text_stats(args.input)
        report["pdfType"] = input_info.get("pdfType", "unknown")
        report["pagesConverted"] = int(input_info.get("pages") or input_stats["pages"])

        lang = resolve_ocr_language(args.lang, report)
        report["ocrLanguage"] = lang

        ocrmypdf = find_ocrmypdf(args.ocrmypdf)
        if not ocrmypdf:
            raise RuntimeError("OCRmyPDF is not installed.")

        force = truthy(args.force, default=False)
        if str(args.force).strip().lower() in {"", "auto"}:
            force = (
                int(input_info.get("textCharacters") or 0) < 25
                or int(input_info.get("imageBackedPages") or 0) > 0
            )

        stdout, stderr = run_ocrmypdf(
            ocrmypdf,
            args.input,
            args.output,
            sidecar,
            lang,
            input_info,
            force=force,
            deskew=truthy(args.deskew, default=True),
            rotate_pages=truthy(args.rotate_pages, default=True),
        )

        if not os.path.exists(args.output):
            message = (
                stderr or stdout or "OCRmyPDF did not create an output file."
            ).strip()
            raise RuntimeError(message[:1200])

        output_stats = text_stats(args.output)
        sidecar_text = ""
        if os.path.exists(sidecar):
            try:
                sidecar_text = Path(sidecar).read_text(
                    encoding="utf-8", errors="ignore"
                )
            except Exception:
                sidecar_text = ""

        input_chars = int(input_stats["characters"])
        output_chars = int(output_stats["characters"])
        output_words = int(output_stats["words"])
        sidecar_words = len(re.findall(r"\S+", sidecar_text))

        if input_chars < 8 and output_chars < 8 and sidecar_words < 1:
            raise RuntimeError(
                "OCR finished but no searchable text layer was detected. Try a clearer scan or install the correct Tesseract language data."
            )

        report["editableTextDetected"] = output_chars > 0
        report["editableTextBoxes"] = int(output_stats["textPages"])
        report["editableCharacters"] = output_chars
        report["outputEditableCharacters"] = output_chars
        report["outputTextRuns"] = output_words
        report["ocrTextCandidates"] = max(output_words, sidecar_words)
        report["hiddenTextLayer"] = input_chars < 8 and output_chars > 0
        report["visibleEditableTextLayer"] = input_chars >= 8
        report["textCoverageEstimate"] = min(
            100,
            round((output_stats["textPages"] / max(1, output_stats["pages"])) * 100),
        )
        report["ocrPasses"].append(
            "ocrmypdf/force-ocr" if force else "ocrmypdf/skip-text"
        )

        if input_chars >= 25 and not force:
            report["resolvedMode"] = "already-searchable-or-mixed"
            report["notes"].append(
                "This PDF already had selectable text. Pages without text were OCR processed where needed."
            )
        else:
            report["notes"].append(
                "OCR text layer added. The page appearance is intentionally preserved while text becomes searchable/selectable."
            )

        noisy = [line for line in (stderr or stdout).splitlines() if line.strip()]
        winerror_noise = [line for line in noisy if "WinError 2" in line]
        ignored_fragments = (
            "WinError 2",
            "Image optimization ratio",
            "Total file size ratio",
            "Parsing ",
            "Postprocessing",
            "Output file is a PDF",
            "Auto mode:",
            "Consider using the pymupdf_layout package",
        )
        meaningful = [
            line
            for line in noisy
            if not any(fragment in line for fragment in ignored_fragments)
        ]
        if winerror_noise:
            report["notes"].append(
                "OCRmyPDF reported non-fatal Windows helper warnings, but the searchable layer was verified."
            )
        if meaningful:
            report["warnings"].extend(meaningful[:3])

        if args.report:
            Path(args.report).write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        return 0
    except Exception as exc:
        report["warnings"].append(str(exc))
        if args.report:
            try:
                Path(args.report).write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
            except Exception:
                pass
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
