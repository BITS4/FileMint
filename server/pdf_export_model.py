"""Shared models and reporting primitives for PDF exports."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pdf_to_docx import inspect_pdf


@dataclass
class TextLine:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    font_size: float
    conf: float = 100.0


@dataclass
class TextWord:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    conf: float = 100.0


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", "").split())


def points_to_emu(value: float) -> int:
    return int(value / 72.0 * 914400)


def make_report(src: str, target: str, mode: str = "premium") -> dict[str, Any]:
    info = inspect_pdf(src)
    return {
        "engine": "filemint-pdf-export",
        "requestedMode": mode,
        "resolvedMode": f"premium-pdf-to-{target}",
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
        "tableDetectionEnabled": True,
        "layoutPreservationEnabled": True,
        "nonEditableVisualFallback": False,
        "warnings": [],
        "notes": [],
    }
