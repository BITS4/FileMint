"""Conversion-mode coverage for scanned PDFs with native or OCR text layers."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz

from server.pdf_to_docx_core import scan
from server.pdf_to_docx_core.models import LineBox, WordBox


def create_pdf(path: Path) -> None:
    document = fitz.open()
    document.new_page(width=240, height=160)
    document.save(path)
    document.close()


def line(text: str, *, conf: float = 92, top: float = 20) -> LineBox:
    word = WordBox(text, 20, top, 120, 18, conf, 1, 1, 1)
    return LineBox(
        text,
        [word],
        20,
        top,
        120,
        18,
        conf,
        400,
        267,
        240,
        160,
        [(20, 140, text)],
    )


def report() -> dict[str, object]:
    return {"notes": [], "warnings": [], "pagesConverted": 1}


def stats(
    value: LineBox, *, candidates: int = 1, skipped: int = 0
) -> tuple[list[LineBox], dict[str, int]]:
    return [value], {
        "ocrTextCandidates": candidates,
        "editableTextBoxes": 1,
        "editableCharacters": len(value.text),
        "skippedLowConfidence": skipped,
    }


class ScanTextLayerModeTests(unittest.TestCase):
    def test_local_premium_ocr_merges_a_second_pass_and_reports_uncertain_text(
        self,
    ) -> None:
        primary = line("Primary OCR", conf=50)
        secondary = line("Secondary OCR", top=50)
        quality = report()
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "scan.pdf")
            target = Path(tmp, "scan.docx")
            create_pdf(source)
            with (
                patch.object(scan, "FAST_HOSTED_OCR", False),
                patch.object(scan, "native_pdf_line_boxes", return_value=[]),
                patch.object(
                    scan,
                    "collect_ocr_lines",
                    side_effect=[[primary], [secondary]],
                ) as collect,
                patch.object(scan, "transcript_rebuild_likely", return_value=False),
                patch.object(
                    scan, "merge_line_candidates", return_value=[primary, secondary]
                ) as merge,
                patch.object(
                    scan,
                    "exact_editable_lines",
                    return_value=stats(primary, candidates=2, skipped=1),
                ),
                patch.object(scan, "append_linebox_flow_paragraph") as append_line,
            ):
                scan.to_docx_scan_text_layer(
                    str(source),
                    str(target),
                    "eng",
                    quality,
                    premium=True,
                    table_detection=True,
                    quality="low",
                )

        self.assertEqual(collect.call_count, 2)
        merge.assert_called_once_with([primary], [secondary], "eng")
        append_line.assert_called_once()
        self.assertEqual(quality["resolvedMode"], "premium-scan-text-flow")
        self.assertEqual(quality["lowConfidenceOcrAreas"], 1)
        self.assertTrue(
            any("too uncertain" in str(item) for item in quality["warnings"])
        )

    def test_hosted_transcript_grid_is_rebuilt_as_a_word_table(self) -> None:
        transcript = line("Student academic course grade 5/5")
        geometry = {
            "xPositionsPx": list(range(6)),
            "yPositionsPx": list(range(8)),
        }
        quality = report()
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "transcript.pdf")
            target = Path(tmp, "transcript.docx")
            create_pdf(source)
            with (
                patch.object(scan, "FAST_HOSTED_OCR", True),
                patch.object(scan, "native_pdf_line_boxes", return_value=[]),
                patch.object(
                    scan, "detect_transcript_grid_geometry", return_value=geometry
                ),
                patch.object(
                    scan,
                    "collect_hosted_transcript_ocr_lines",
                    return_value=[transcript],
                ),
                patch.object(scan, "transcript_rebuild_likely", return_value=True),
                patch.object(scan, "dense_table_scan_likely", return_value=True),
                patch.object(scan, "build_scanned_table_page") as build_table,
            ):
                scan.to_docx_scan_text_layer(
                    str(source),
                    str(target),
                    "eng",
                    quality,
                    premium=True,
                    table_detection=True,
                    quality="low",
                )

        build_table.assert_called_once()
        self.assertEqual(quality["tablesRebuiltAsWord"], 1)
        self.assertFalse(quality["editableTextDetected"])

    def test_hosted_preview_and_grid_failures_fall_back_to_full_scan_safely(
        self,
    ) -> None:
        detected = line("Recovered OCR")
        quality = report()
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "fallback.pdf")
            target = Path(tmp, "fallback.docx")
            create_pdf(source)
            source_doc = fitz.open(source)
            primary_pixmap = source_doc[0].get_pixmap(dpi=72, alpha=False)
            source_doc.close()
            with (
                patch.object(scan, "FAST_HOSTED_OCR", True),
                patch.object(
                    fitz.Page,
                    "get_pixmap",
                    side_effect=[primary_pixmap, RuntimeError("preview failed")],
                ),
                patch.object(scan, "native_pdf_line_boxes", return_value=[]),
                patch.object(
                    scan,
                    "detect_transcript_grid_geometry",
                    side_effect=RuntimeError("grid failed"),
                ),
                patch.object(scan, "collect_ocr_lines", return_value=[detected]),
                patch.object(scan, "transcript_rebuild_likely", return_value=False),
                patch.object(
                    scan, "exact_editable_lines", return_value=stats(detected)
                ),
                patch.object(scan, "append_linebox_flow_paragraph") as append_line,
            ):
                scan.to_docx_scan_text_layer(
                    str(source),
                    str(target),
                    "eng",
                    quality,
                    premium=True,
                    table_detection=True,
                    quality="low",
                )

        append_line.assert_called_once()
        self.assertTrue(quality["editableTextDetected"])
        self.assertEqual(quality["textCoverageEstimate"], 100)


if __name__ == "__main__":
    unittest.main()
