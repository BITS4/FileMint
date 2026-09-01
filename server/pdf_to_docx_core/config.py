"""Import-compatible access to the converter configuration."""

from __future__ import annotations

try:
    from ..pdf_to_docx_config import (
        DOWNLOADABLE_TESSDATA,
        FAST_HOSTED_OCR,
        LANG_ALIASES,
        LOCAL_TESSDATA_DIR,
        MODE_ALIASES,
        OCR_AUTO_DOWNLOAD_LANGS,
        OCR_AUTO_LANGS,
        TESSDATA_FAST_BASE,
        TESSDATA_FAST_REVISION,
        TESSDATA_FAST_SHA256,
        clean_choice,
        effective_ocr_request,
        engine_mode,
        is_fast_hosted_ocr,
        quality_dpi,
        safe_mode,
        truthy,
    )
except ImportError:  # Direct execution via ``python server/pdf_to_docx.py``.
    from pdf_to_docx_config import (
        DOWNLOADABLE_TESSDATA,
        FAST_HOSTED_OCR,
        LANG_ALIASES,
        LOCAL_TESSDATA_DIR,
        MODE_ALIASES,
        OCR_AUTO_DOWNLOAD_LANGS,
        OCR_AUTO_LANGS,
        TESSDATA_FAST_BASE,
        TESSDATA_FAST_REVISION,
        TESSDATA_FAST_SHA256,
        clean_choice,
        effective_ocr_request,
        engine_mode,
        is_fast_hosted_ocr,
        quality_dpi,
        safe_mode,
        truthy,
    )

__all__ = [
    "DOWNLOADABLE_TESSDATA",
    "FAST_HOSTED_OCR",
    "LANG_ALIASES",
    "LOCAL_TESSDATA_DIR",
    "MODE_ALIASES",
    "OCR_AUTO_DOWNLOAD_LANGS",
    "OCR_AUTO_LANGS",
    "TESSDATA_FAST_BASE",
    "TESSDATA_FAST_REVISION",
    "TESSDATA_FAST_SHA256",
    "clean_choice",
    "effective_ocr_request",
    "engine_mode",
    "is_fast_hosted_ocr",
    "quality_dpi",
    "safe_mode",
    "truthy",
]
