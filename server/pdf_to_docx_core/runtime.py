"""Runtime discovery, dependency management, and PDF inspection."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from typing import Any

from .config import (
    DOWNLOADABLE_TESSDATA,
    FAST_HOSTED_OCR,
    LANG_ALIASES,
    LOCAL_TESSDATA_DIR,
    OCR_AUTO_DOWNLOAD_LANGS,
    OCR_AUTO_LANGS,
    TESSDATA_FAST_BASE,
    TESSDATA_FAST_SHA256,
)


def log(*a: object) -> None:
    print(*a, file=sys.stderr)


def find_tesseract() -> str | None:
    found = shutil.which("tesseract")
    if found:
        return found
    for p in [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        "/usr/bin/tesseract",
        "/opt/homebrew/bin/tesseract",
        "/usr/local/bin/tesseract",
    ]:
        if os.path.isfile(p):
            return p
    return None


def local_tesseract_languages() -> set[str]:
    if not os.path.isdir(LOCAL_TESSDATA_DIR):
        return set()
    return {
        os.path.splitext(name)[0]
        for name in os.listdir(LOCAL_TESSDATA_DIR)
        if name.endswith(".traineddata")
    }


def system_tesseract_languages(tess: str) -> set[str]:
    try:
        r = subprocess.run(
            [tess, "--list-langs"], capture_output=True, text=True, timeout=10
        )
        lines = (r.stdout or r.stderr or "").splitlines()
        return {
            x.strip()
            for x in lines[1:]
            if x.strip() and not x.lower().startswith("list of")
        }
    except Exception:
        return set()


def installed_tesseract_languages(tess: str) -> set[str]:
    return system_tesseract_languages(tess) | local_tesseract_languages()


def tessdata_checksum(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def valid_project_tessdata(path: str, lang: str) -> bool:
    expected = TESSDATA_FAST_SHA256.get(lang)
    return bool(
        expected
        and os.path.exists(path)
        and os.path.getsize(path) > 1024
        and tessdata_checksum(path) == expected
    )


def ensure_project_tessdata(lang: str, report: dict[str, Any]) -> bool:
    if lang in installed_tesseract_languages(find_tesseract() or ""):
        return True
    if lang not in DOWNLOADABLE_TESSDATA:
        return False
    os.makedirs(LOCAL_TESSDATA_DIR, exist_ok=True)
    dst = os.path.join(LOCAL_TESSDATA_DIR, f"{lang}.traineddata")
    if valid_project_tessdata(dst, lang):
        return True

    url = f"{TESSDATA_FAST_BASE}/{lang}.traineddata"
    tmp = dst + ".download"
    try:
        urllib.request.urlretrieve(url, tmp)
        if not valid_project_tessdata(tmp, lang):
            raise RuntimeError(
                "downloaded language data checksum does not match the pinned model"
            )
        os.replace(tmp, dst)
        report["notes"].append(f"Downloaded OCR language data: {lang}.")
        return True
    except Exception as e:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
        report["warnings"].append(
            f"Could not download OCR language data for {lang}: {e}"
        )
        return False


def ensure_project_tessdata_many(langs: list[str], report: dict[str, Any]) -> None:
    for lang in langs:
        if lang and lang != "osd":
            ensure_project_tessdata(lang, report)


def tessdata_dir_for_lang(lang: str) -> str | None:
    parts = [p for p in re.split(r"[,+\s]+", lang) if p and p != "osd"]
    local = local_tesseract_languages()
    if parts and all(p in local for p in parts):
        return LOCAL_TESSDATA_DIR
    return None


def resolve_ocr_language(requested: str, report: dict[str, Any]) -> str:
    tess = find_tesseract()
    if not tess:
        raise RuntimeError(
            "Tesseract OCR is not installed. Install it, then add needed language packs."
        )

    raw = LANG_ALIASES.get(
        (requested or "auto").strip().lower(), requested.strip().lower()
    )
    if raw == "auto":
        if not FAST_HOSTED_OCR:
            ensure_project_tessdata_many(OCR_AUTO_DOWNLOAD_LANGS, report)
        else:
            report["notes"].append(
                "Hosted OCR fast mode used installed language packs only."
            )
    else:
        if not FAST_HOSTED_OCR:
            ensure_project_tessdata_many(
                [p for p in re.split(r"[,+\s]+", raw) if p], report
            )
    installed = installed_tesseract_languages(tess)
    if raw == "auto":
        if installed:
            if FAST_HOSTED_OCR:
                hosted_preferred = ["eng"]
                chosen = [x for x in hosted_preferred if x in installed]
            else:
                chosen = [x for x in OCR_AUTO_LANGS if x in installed]
            if not chosen and "eng" in installed:
                chosen = ["eng"]
            if not chosen:
                chosen = sorted(installed)[:1]
            if len(chosen) < 2:
                report["warnings"].append(
                    "Auto OCR language is limited because only a small set of Tesseract languages is installed."
                )
            lang = "+".join(chosen) if chosen else "eng"
        else:
            lang = "eng+rus"
            report["warnings"].append(
                "Could not list Tesseract languages; using eng+rus."
            )
    else:
        parts = [p for p in re.split(r"[,+\s]+", raw) if p]
        if installed:
            missing = [p for p in parts if p not in installed]
            present = [p for p in parts if p in installed]
            if missing:
                report["warnings"].append(
                    "Missing Tesseract language data: " + ", ".join(missing) + "."
                )
            if not present:
                present = ["eng"] if "eng" in installed else sorted(installed)[:1]
                report["warnings"].append(
                    "Falling back to OCR language: " + "+".join(present) + "."
                )
            lang = "+".join(present)
        else:
            lang = "+".join(parts) if parts else "eng"

    report["ocrLanguage"] = lang
    local_parts = [
        p for p in re.split(r"[,+\s]+", lang) if p in local_tesseract_languages()
    ]
    if local_parts:
        report["notes"].append(
            "OCR used project language data: " + "+".join(local_parts) + "."
        )
    return lang


def inspect_pdf(path: str) -> dict[str, Any]:
    import fitz

    doc = fitz.open(path)
    details: list[dict[str, Any]] = []
    try:
        total_chars = 0
        text_pages = 0
        image_pages = 0
        image_count = 0
        image_backed_pages = 0
        table_count = 0
        vector_pages = 0

        for page in doc:
            text = page.get_text("text") or ""
            chars = len(text.strip())
            images = len(page.get_images(full=True))
            max_image_coverage = 0.0
            for image in page.get_images(full=True):
                try:
                    for rect in page.get_image_rects(image[0]):
                        coverage = (rect.width * rect.height) / max(
                            1.0, page.rect.width * page.rect.height
                        )
                        max_image_coverage = max(max_image_coverage, coverage)
                except Exception:
                    continue
            drawings = len(page.get_drawings())
            tables = 0
            try:
                found = page.find_tables()
                tables = len(getattr(found, "tables", []) or [])
            except Exception:
                tables = 0

            total_chars += chars
            image_count += images
            table_count += tables
            if chars >= 25:
                text_pages += 1
            if images > 0 and chars < 25:
                image_pages += 1
            if max_image_coverage >= 0.65:
                image_backed_pages += 1
            if drawings > 20:
                vector_pages += 1

            rect = page.rect
            details.append(
                {
                    "page": page.number + 1,
                    "width": round(rect.width, 2),
                    "height": round(rect.height, 2),
                    "textCharacters": chars,
                    "images": images,
                    "maxImageCoverage": round(max_image_coverage, 3),
                    "tables": tables,
                    "vectorObjects": drawings,
                    "scannedLikely": chars < 25 and images > 0,
                    "imageBackedTextLayerLikely": chars >= 25
                    and max_image_coverage >= 0.65,
                }
            )

        pages = len(doc)
        if text_pages == 0:
            pdf_type = "scanned"
        elif text_pages < pages:
            pdf_type = "mixed"
        elif image_pages > 0:
            pdf_type = "mixed"
        else:
            pdf_type = "digital"

        return {
            "pages": pages,
            "pdfType": pdf_type,
            "textPages": text_pages,
            "imagePages": image_pages,
            "imageBackedPages": image_backed_pages,
            "textCharacters": total_chars,
            "imagesDetected": image_count,
            "tablesDetected": table_count,
            "vectorPages": vector_pages,
            "pageDetails": details,
        }
    finally:
        doc.close()


def has_text_layer(path: str) -> bool:
    return inspect_pdf(path)["textCharacters"] >= 25


def to_docx_pdf2docx(src: str, dst: str, report: dict[str, Any]) -> None:
    from pdf2docx import Converter

    cv = Converter(src)
    try:
        cv.convert(dst)
    finally:
        cv.close()

    report["editableTextDetected"] = True
    report["notes"].append(
        "Digital PDF converted with pdf2docx. Text, layout, images and detected tables are rebuilt as editable DOCX objects where the PDF structure allows it."
    )
