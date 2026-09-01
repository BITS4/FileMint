"""End-to-end orchestration tests for exact-visual OCR output modes."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz

from server.pdf_to_docx_core import exact
from server.pdf_to_docx_core.models import LineBox, VisualFragment, VisualRule, WordBox


def create_pdf(path: Path, pages: int = 1) -> None:
    document = fitz.open()
    for _ in range(pages):
        document.new_page(width=240, height=160)
    document.save(path)
    document.close()


def ocr_line(text: str = "Editable text", *, conf: float = 94) -> LineBox:
    word = WordBox(text, 20, 25, 120, 18, conf, 1, 1, 1)
    return LineBox(
        text,
        [word],
        20,
        25,
        120,
        18,
        conf,
        400,
        267,
        240,
        160,
        [(20, 140, text)],
    )


def quality_report(**extra: object) -> dict[str, object]:
    return {
        "notes": [],
        "warnings": [],
        "pagesConverted": 1,
        "tablesDetected": 0,
        **extra,
    }


def editable_result(
    value: LineBox,
    *,
    candidates: int = 1,
    skipped_low: int = 0,
    colored: int = 0,
) -> tuple[list[LineBox], dict[str, int]]:
    return [value], {
        "ocrTextCandidates": candidates,
        "editableTextBoxes": 1,
        "editableCharacters": len(value.text),
        "skippedColoredMarks": colored,
        "skippedLowConfidence": skipped_low,
        "skippedNoise": 0,
    }


class ExactVisualModeTests(unittest.TestCase):
    def test_hosted_timeout_returns_valid_visual_fallback_with_clear_diagnostics(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "scan.pdf")
            target = Path(tmp, "fallback.docx")
            create_pdf(source)
            report = quality_report(hostedOcrTimedOut=True)
            with (
                patch.object(exact, "FAST_HOSTED_OCR", True),
                patch.object(
                    exact, "detect_transcript_grid_geometry", return_value=None
                ),
                patch.object(exact, "collect_ocr_lines", return_value=[]),
                patch.object(exact, "append_exact_visual_page") as append_visual,
            ):
                exact.ocr_to_docx_exact_visual(
                    str(source),
                    str(target),
                    "eng",
                    report,
                    premium=True,
                    table_detection=True,
                    quality="low",
                )

        append_visual.assert_called_once()
        self.assertTrue(report["nonEditableVisualFallback"])
        self.assertFalse(report["editableTextDetected"])
        self.assertTrue(any("timed out" in str(item) for item in report["warnings"]))
        self.assertTrue(
            any("valid visual DOCX" in str(item) for item in report["notes"])
        )

    def test_detected_transcript_is_rebuilt_as_an_editable_word_table(self) -> None:
        detected = ocr_line("Student academic grade 5/5")
        geometry = {
            "xPositionsPx": list(range(6)),
            "yPositionsPx": list(range(8)),
        }
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "transcript.pdf")
            target = Path(tmp, "table.docx")
            create_pdf(source)
            report = quality_report()
            with (
                patch.object(exact, "FAST_HOSTED_OCR", True),
                patch.object(
                    exact, "detect_transcript_grid_geometry", return_value=geometry
                ),
                patch.object(
                    exact,
                    "collect_hosted_transcript_ocr_lines",
                    return_value=[detected],
                ),
                patch.object(exact, "dense_table_scan_likely", return_value=True),
                patch.object(exact, "transcript_rebuild_likely", return_value=True),
                patch.object(
                    exact,
                    "exact_editable_word_lines",
                    return_value=editable_result(detected),
                ),
                patch.object(exact, "build_scanned_table_page") as build_table,
            ):
                exact.ocr_to_docx_exact_visual(
                    str(source),
                    str(target),
                    "eng",
                    report,
                    premium=True,
                    table_detection=True,
                    quality="low",
                )

        build_table.assert_called_once()
        self.assertEqual(report["tablesRebuiltAsWord"], 1)
        self.assertTrue(report["editableTextDetected"])
        self.assertTrue(
            any("editable Word table" in str(item) for item in report["notes"])
        )

    def test_generic_dense_scan_uses_hidden_text_to_avoid_visual_corruption(
        self,
    ) -> None:
        primary = ocr_line("Primary OCR")
        secondary = ocr_line("Secondary OCR")
        result = editable_result(primary, candidates=2)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "dense.pdf")
            target = Path(tmp, "dense.docx")
            create_pdf(source)
            report = quality_report()
            with (
                patch.object(exact, "FAST_HOSTED_OCR", False),
                patch.object(
                    exact,
                    "collect_ocr_lines",
                    side_effect=[[primary], [secondary]],
                ) as collect,
                patch.object(exact, "dense_table_scan_likely", return_value=True),
                patch.object(exact, "transcript_rebuild_likely", return_value=False),
                patch.object(
                    exact, "merge_line_candidates", return_value=[primary, secondary]
                ) as merge,
                patch.object(exact, "exact_editable_lines", return_value=result),
                patch.object(exact, "append_exact_visual_page") as append_visual,
            ):
                exact.ocr_to_docx_exact_visual(
                    str(source),
                    str(target),
                    "eng",
                    report,
                    premium=True,
                    table_detection=True,
                    visible_text=True,
                    quality="low",
                )

        self.assertEqual(collect.call_count, 2)
        merge.assert_called_once_with([primary], [secondary], "eng")
        append_visual.assert_called_once()
        self.assertTrue(report["hiddenTextLayer"])
        self.assertFalse(report["visibleEditableTextLayer"])
        self.assertTrue(
            any("dense non-template" in str(item) for item in report["warnings"])
        )

    def test_hidden_exact_mode_preserves_scan_and_reports_uncertain_regions(
        self,
    ) -> None:
        accepted = ocr_line("Searchable text", conf=40)
        fragment = VisualFragment("fragment.png", 1, 2, 3, 4)
        rule = VisualRule(5, 6, 100, 1, "#123456")
        fallback_warning = (
            "Hosted OCR timed out before editable text reconstruction could finish. "
            "FileMint returned a visual DOCX fallback instead of failing."
        )
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "hidden.pdf")
            target = Path(tmp, "hidden.docx")
            create_pdf(source)
            report = quality_report(
                hostedOcrTimedOut=True,
                warnings=[fallback_warning],
            )
            with (
                patch.object(exact, "FAST_HOSTED_OCR", False),
                patch.object(exact, "collect_ocr_lines", return_value=[accepted]),
                patch.object(exact, "dense_table_scan_likely", return_value=False),
                patch.object(
                    exact,
                    "exact_editable_lines",
                    return_value=editable_result(
                        accepted, candidates=3, skipped_low=2, colored=1
                    ),
                ),
                patch.object(
                    exact, "segment_visual_layer", return_value=([fragment], [rule])
                ) as segment,
                patch.object(exact, "append_exact_visual_page") as append_visual,
            ):
                exact.ocr_to_docx_exact_visual(
                    str(source),
                    str(target),
                    "eng",
                    report,
                    premium=True,
                    table_detection=False,
                    visible_text=False,
                    quality="low",
                    keep_visual_objects=False,
                )

        segment.assert_not_called()
        append_visual.assert_called_once()
        self.assertTrue(report["hiddenTextLayer"])
        self.assertFalse(report["nonEditableVisualFallback"])
        self.assertNotIn(fallback_warning, report["warnings"])
        self.assertTrue(
            any("parts it could detect" in str(item) for item in report["warnings"])
        )
        self.assertTrue(
            any("too uncertain" in str(item) for item in report["warnings"])
        )
        self.assertTrue(
            any("stamp/signature" in str(item) for item in report["warnings"])
        )


if __name__ == "__main__":
    unittest.main()
