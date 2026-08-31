"""Validated configuration helpers for the PDF-to-DOCX pipeline."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

OCR_AUTO_LANGS = ["eng", "rus", "tgk", "fas", "ara", "chi_sim", "chi_tra", "kor"]
OCR_AUTO_DOWNLOAD_LANGS = ["chi_sim", "kor"]
LOCAL_TESSDATA_DIR = os.path.join(os.path.dirname(__file__), "tessdata")
TESSDATA_FAST_BASE = "https://github.com/tesseract-ocr/tessdata_fast/raw/main"
DOWNLOADABLE_TESSDATA = {"fas", "ara", "chi_sim", "chi_tra", "kor"}
LANG_ALIASES = {
    "": "auto",
    "auto": "auto",
    "english": "eng",
    "russian": "rus",
    "tajik": "tgk",
    "persian": "fas",
    "farsi": "fas",
    "arabic": "ara",
    "chinese": "chi_sim",
    "simplified_chinese": "chi_sim",
    "korean": "kor",
}
MODE_ALIASES = {
    "auto": "hybrid",
    "pro": "high-accuracy",
    "premium": "high-accuracy",
    "ultra": "high-accuracy",
    "premium-editable": "high-accuracy",
    "max-editable": "high-accuracy",
    "editable": "high-accuracy",
    "editable-accurate": "high-accuracy",
    "accurate": "high-accuracy",
    "high": "high-accuracy",
    "high-accuracy": "high-accuracy",
    "high_accuracy": "high-accuracy",
    "high-accuracy-editable": "high-accuracy",
    "hybrid": "hybrid",
    "hybrid-editable": "hybrid",
    "exact": "exact",
    "exact-visual": "exact",
    "ocr": "ocr",
    "ocr-editable": "ocr",
    "image": "image",
    "image-only": "image",
}


def truthy(value: str | bool | None, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def is_fast_hosted_ocr(env: Mapping[str, str] | None = None) -> bool:
    values = env if env is not None else os.environ
    return truthy(values.get("FILEMINT_FAST_HOSTED_OCR"), False) or values.get("RENDER", "").strip().lower() == "true"


FAST_HOSTED_OCR = is_fast_hosted_ocr()


def safe_mode(mode: str) -> str:
    return MODE_ALIASES.get((mode or "hybrid").strip().lower(), "hybrid")


def engine_mode(mode: str) -> str:
    return "premium" if mode in {"high-accuracy", "hybrid"} else mode


def clean_choice(value: str | None, allowed: set[str], default: str) -> str:
    raw = (value or default).strip().lower()
    return raw if raw in allowed else default


def quality_dpi(quality: str, default: int = 300, fast_hosted: bool | None = None) -> int:
    dpi = {
        "low": 160,
        "medium": 220,
        "high": default,
        "original": 360,
    }.get(quality, default)
    hosted = FAST_HOSTED_OCR if fast_hosted is None else fast_hosted
    return min(dpi, 72) if hosted else dpi


def effective_ocr_request(lang: str, auto_detect: bool, report: dict[str, Any]) -> str:
    requested = (lang or "auto").strip()
    if auto_detect:
        return requested or "auto"
    if requested.lower() in {"", "auto", "mixed", "auto-mixed"}:
        report.setdefault("warnings", []).append(
            "OCR language auto-detect is off, but no manual language was selected. English OCR will be used."
        )
        return "eng"
    return requested

