"""Command-line orchestration for the PDF-to-DOCX converter."""

from __future__ import annotations

import argparse
from typing import Any

from .config import clean_choice, effective_ocr_request, engine_mode, safe_mode, truthy
from .exact import ocr_to_docx_exact_visual
from .image import ocr_to_docx_layout, to_docx_image
from .native import to_docx_digital_text_flow
from .positioned import (
    image_backed_text_layer_likely,
    image_backed_text_layer_needs_ocr,
)
from .reporting import (
    ensure_output,
    merge_output_stats,
    repair_empty_editable_output,
    write_report,
)
from .runtime import inspect_pdf, resolve_ocr_language, to_docx_pdf2docx
from .scan import to_docx_scan_text_layer


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--mode", default="hybrid")
    ap.add_argument("--lang", default="auto")
    ap.add_argument("--auto-detect-language", default="true")
    ap.add_argument("--table-detection", default="true")
    ap.add_argument("--preserve-layout", default="true")
    ap.add_argument("--keep-visual-objects", default="true")
    ap.add_argument("--visual-object-format", default="png")
    ap.add_argument("--docx-quality", default="high")
    ap.add_argument("--report")
    a = ap.parse_args()

    requested_mode = safe_mode(a.mode)
    run_mode = engine_mode(requested_mode)
    premium_mode = run_mode == "premium"
    auto_detect_language = truthy(a.auto_detect_language, True)
    table_detection = truthy(a.table_detection, True)
    preserve_layout = truthy(a.preserve_layout, True)
    keep_visual_objects = truthy(a.keep_visual_objects, True)
    visual_object_format = clean_choice(
        a.visual_object_format, {"png", "jpg", "jpeg"}, "png"
    )
    if visual_object_format == "jpeg":
        visual_object_format = "jpg"
    docx_quality = clean_choice(
        a.docx_quality, {"low", "medium", "high", "original"}, "high"
    )
    report: dict[str, Any] = {
        "engine": "filemint-local",
        "requestedMode": requested_mode,
        "resolvedMode": requested_mode,
        "engineMode": run_mode,
        "pdfType": "unknown",
        "pagesConverted": 0,
        "editableTextDetected": False,
        "tablesDetected": 0,
        "imagesDetected": 0,
        "lowConfidenceOcrAreas": 0,
        "editableTextBoxes": 0,
        "editableCharacters": 0,
        "ocrTextCandidates": 0,
        "textCoverageEstimate": 0,
        "visualObjectsPreserved": 0,
        "ocrPasses": [],
        "ocrLanguage": None,
        "autoDetectLanguage": auto_detect_language,
        "tableDetectionEnabled": table_detection,
        "layoutPreservationEnabled": preserve_layout,
        "keepVisualObjects": keep_visual_objects,
        "visualObjectFormat": visual_object_format,
        "docxQuality": docx_quality,
        "nonEditableVisualFallback": False,
        "warnings": [],
        "notes": [],
        "pageDetails": [],
    }

    try:
        info = inspect_pdf(a.input)
        report.update(
            {
                "pdfType": info["pdfType"],
                "pagesConverted": info["pages"],
                "imageBackedPages": info.get("imageBackedPages", 0),
                "tablesDetected": info["tablesDetected"],
                "imagesDetected": info["imagesDetected"],
                "pageDetails": info["pageDetails"],
            }
        )

        digital_enough = (
            info["pdfType"] in {"digital", "mixed"} and info["textCharacters"] >= 25
        )
        scanned_enough = info["pdfType"] == "scanned" or (
            info["pdfType"] == "mixed" and info["textPages"] < info["pages"]
        )
        image_backed_text_layer = digital_enough and image_backed_text_layer_likely(
            info
        )
        lang_request = effective_ocr_request(a.lang, auto_detect_language, report)
        editable_modes = {"premium", "exact"}
        digital_text_flow_candidate = (
            premium_mode
            and digital_enough
            and not image_backed_text_layer
            and int(info.get("imagesDetected", 0)) == 0
            and int(info.get("tablesDetected", 0)) == 0
            and int(info.get("textCharacters", 0)) >= 500
        )

        if run_mode in editable_modes and image_backed_text_layer:
            report["warnings"].append(
                "This PDF has full-page scan images plus a text layer, so FileMint avoided the standard PDF object converter and rebuilt the content as editable Word text."
            )
            lang: str | None = None
            if premium_mode or image_backed_text_layer_needs_ocr(info):
                try:
                    lang = resolve_ocr_language(lang_request, report)
                except Exception as e:
                    report["warnings"].append(
                        f"OCR fallback is unavailable ({e}); pages with a weak text layer may remain less editable."
                    )
            to_docx_scan_text_layer(
                a.input,
                a.output,
                lang,
                report,
                premium=premium_mode,
                table_detection=table_detection,
                quality=docx_quality,
            )
        elif digital_text_flow_candidate:
            to_docx_digital_text_flow(a.input, a.output, report)
        elif run_mode in editable_modes and digital_enough:
            report["resolvedMode"] = requested_mode
            if premium_mode:
                report["notes"].append(
                    "High Accuracy/Hybrid mode on this digital PDF used the editable object-model converter because images or detected tables make text-flow reconstruction less appropriate."
                )
            elif requested_mode == "exact":
                report["notes"].append(
                    "Exact Visual Mode on digital PDFs uses the same editable layout engine with stricter visual-fidelity intent."
                )
            to_docx_pdf2docx(a.input, a.output, report)
        elif run_mode in editable_modes and scanned_enough:
            if requested_mode == "hybrid":
                report["resolvedMode"] = "hybrid-ocr-editable-visual"
            elif requested_mode == "high-accuracy":
                report["resolvedMode"] = "high-accuracy-ocr-editable-visual"
            elif requested_mode == "exact":
                report["resolvedMode"] = "exact-ocr-visual"
            else:
                report["resolvedMode"] = (
                    "ocr-editable-visual" if preserve_layout else "ocr"
                )
            report["warnings"].append(
                "This PDF looks scanned/image-based, so conversion was routed through OCR reconstruction."
            )
            lang = resolve_ocr_language(lang_request, report)
            if preserve_layout or premium_mode or requested_mode == "exact":
                ocr_to_docx_exact_visual(
                    a.input,
                    a.output,
                    lang,
                    report,
                    premium=premium_mode,
                    table_detection=table_detection,
                    visible_text=True,
                    quality=docx_quality,
                    keep_visual_objects=keep_visual_objects,
                )
            else:
                ocr_to_docx_layout(
                    a.input,
                    a.output,
                    lang,
                    table_detection,
                    report,
                    quality=docx_quality,
                )
        elif requested_mode == "ocr":
            report["resolvedMode"] = "ocr-editable-visual" if preserve_layout else "ocr"
            lang = resolve_ocr_language(lang_request, report)
            if preserve_layout:
                ocr_to_docx_exact_visual(
                    a.input,
                    a.output,
                    lang,
                    report,
                    table_detection=table_detection,
                    visible_text=True,
                    quality=docx_quality,
                    keep_visual_objects=keep_visual_objects,
                )
            else:
                ocr_to_docx_layout(
                    a.input,
                    a.output,
                    lang,
                    table_detection,
                    report,
                    quality=docx_quality,
                )
        elif requested_mode == "image":
            report["resolvedMode"] = "image"
            to_docx_image(
                a.input,
                a.output,
                report,
                quality=docx_quality,
                visual_object_format=visual_object_format,
            )
        else:
            report["resolvedMode"] = "high-accuracy"
            to_docx_pdf2docx(a.input, a.output, report)

        ensure_output(a.output)
        stats = merge_output_stats(report, a.output)
        hosted_timeout_fallback = bool(report.get("hostedOcrTimedOut"))
        if (
            requested_mode != "image"
            and not hosted_timeout_fallback
            and int(stats.get("outputEditableCharacters", 0) or 0) == 0
            and int(stats.get("outputTables", 0) or 0) == 0
        ):
            repair_empty_editable_output(
                a.input,
                a.output,
                lang_request,
                table_detection,
                report,
                docx_quality,
                keep_visual_objects,
            )
            ensure_output(a.output)
            stats = merge_output_stats(report, a.output)
        hosted_timeout_fallback = bool(report.get("hostedOcrTimedOut"))
        if (
            requested_mode != "image"
            and not hosted_timeout_fallback
            and int(stats.get("outputEditableCharacters", 0) or 0) == 0
            and int(stats.get("outputTables", 0) or 0) == 0
        ):
            raise RuntimeError(
                "DOCX output contains no editable text or tables. OCR may need to be installed or a clearer source PDF is required."
            )
    except Exception as e:
        report["warnings"].append(str(e))
        write_report(a.report, report)
        raise

    write_report(a.report, report)
    print("mode=" + str(report["resolvedMode"]))
