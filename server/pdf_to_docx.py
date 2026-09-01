#!/usr/bin/env python3
"""Public compatibility entrypoint for FileMint's PDF-to-DOCX converter.

The implementation lives in focused modules under :mod:`pdf_to_docx_core`.
This facade keeps the CLI and the helper imports consumed by FileMint's other
conversion utilities stable while exposing a deliberately small public API.
"""

from __future__ import annotations

try:  # Package imports used by tests and ``python -m server.pdf_to_docx``.
    from .pdf_to_docx_core.cli import main
    from .pdf_to_docx_core.models import LineBox, VisualFragment, VisualRule, WordBox
    from .pdf_to_docx_core.native import PdfLine, PdfSpan
    from .pdf_to_docx_core.ocr import parse_tsv, run_tesseract_tsv
    from .pdf_to_docx_core.reporting import docx_output_stats
    from .pdf_to_docx_core.runtime import (
        find_tesseract,
        inspect_pdf,
        resolve_ocr_language,
        tessdata_dir_for_lang,
    )
except ImportError:  # Direct execution via ``python server/pdf_to_docx.py``.
    from pdf_to_docx_core.cli import main
    from pdf_to_docx_core.models import LineBox, VisualFragment, VisualRule, WordBox
    from pdf_to_docx_core.native import PdfLine, PdfSpan
    from pdf_to_docx_core.ocr import parse_tsv, run_tesseract_tsv
    from pdf_to_docx_core.reporting import docx_output_stats
    from pdf_to_docx_core.runtime import (
        find_tesseract,
        inspect_pdf,
        resolve_ocr_language,
        tessdata_dir_for_lang,
    )

__all__ = [
    "LineBox",
    "PdfLine",
    "PdfSpan",
    "VisualFragment",
    "VisualRule",
    "WordBox",
    "docx_output_stats",
    "find_tesseract",
    "inspect_pdf",
    "main",
    "parse_tsv",
    "resolve_ocr_language",
    "run_tesseract_tsv",
    "tessdata_dir_for_lang",
]


if __name__ == "__main__":
    main()
