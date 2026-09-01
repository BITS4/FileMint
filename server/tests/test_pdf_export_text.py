"""Branch coverage for positioned text and OCR export helpers."""

from __future__ import annotations

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SERVER_DIR = os.path.dirname(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from pdf_export_model import TextLine, TextWord
from pdf_export_text import (
    join_positioned_words,
    maybe_resolve_ocr,
    native_words,
    ocr_words_for_page,
    page_text_words,
    update_text_metrics,
    words_to_lines,
)


def word(
    text: str,
    x0: float,
    y0: float = 10,
    x1: float | None = None,
    y1: float = 20,
    conf: float = 100,
) -> TextWord:
    return TextWord(text, x0, y0, x1 if x1 is not None else x0 + 10, y1, conf)


def report(pdf_type: str = "native") -> dict:
    return {
        "pdfType": pdf_type,
        "editableTextBoxes": 0,
        "editableCharacters": 0,
        "editableTextDetected": False,
        "ocrTextCandidates": 0,
        "lowConfidenceOcrAreas": 0,
        "ocrPasses": [],
        "textCoverageEstimate": 0,
        "warnings": [],
    }


class PositionedTextTests(unittest.TestCase):
    def test_join_positioned_words_orders_words_and_bounds_spacing(self) -> None:
        words = [word("last", 200, x1=220), word("first", 0, x1=20)]

        joined = join_positioned_words(words)

        self.assertTrue(joined.startswith("first"))
        self.assertTrue(joined.endswith("last"))
        self.assertLessEqual(len(joined) - len("firstlast"), 8)
        self.assertEqual(join_positioned_words([]), "")

    def test_words_to_lines_groups_nearby_words_and_averages_confidence(self) -> None:
        words = [
            word("Mint", 34, y0=11, x1=59, y1=21, conf=80),
            word("File", 0, y0=10, x1=30, y1=20, conf=100),
            word("Second", 0, y0=50, x1=35, y1=62, conf=-1),
        ]

        lines = words_to_lines(words)

        self.assertEqual([line.text for line in lines], ["File Mint", "Second"])
        self.assertEqual(lines[0].conf, 90)
        self.assertEqual(lines[1].conf, 100)
        self.assertGreaterEqual(lines[0].font_size, 6)
        self.assertEqual(words_to_lines([]), [])

    def test_native_words_normalizes_text_and_skips_empty_values(self) -> None:
        page = SimpleNamespace(
            get_text=lambda *_args, **_kwargs: [
                (1, 2, 11, 12, "  File\x00 Mint  ", 0, 0, 0),
                (20, 2, 30, 12, "   ", 0, 0, 1),
            ]
        )

        words = native_words(page)

        self.assertEqual(len(words), 1)
        self.assertEqual(words[0].text, "File Mint")
        self.assertEqual((words[0].x0, words[0].y1), (1.0, 12.0))

    @patch("pdf_export_text.parse_tsv")
    @patch("pdf_export_text.run_tesseract_tsv", return_value="tsv")
    @patch("pdf_export_text.render_page_png", return_value=(200, 100))
    def test_ocr_words_scale_coordinates_and_record_low_confidence(
        self,
        _render,
        run_tesseract,
        parse_tsv,
    ) -> None:
        parse_tsv.return_value = [
            SimpleNamespace(
                words=[
                    SimpleNamespace(
                        text="  OCR  ",
                        left=20,
                        top=10,
                        width=40,
                        height=20,
                        conf=42,
                    ),
                    SimpleNamespace(
                        text=" ", left=0, top=0, width=1, height=1, conf=99
                    ),
                ]
            )
        ]
        page = SimpleNamespace(
            number=1,
            rect=SimpleNamespace(width=400, height=300),
        )
        metrics = report("scanned")

        words = ocr_words_for_page(page, "temp", "eng", metrics)

        self.assertEqual(len(words), 1)
        self.assertEqual((words[0].x0, words[0].y0), (40, 30))
        self.assertEqual((words[0].x1, words[0].y1), (120, 90))
        self.assertEqual(metrics["lowConfidenceOcrAreas"], 1)
        self.assertEqual(metrics["ocrTextCandidates"], 1)
        self.assertEqual(metrics["ocrPasses"], ["psm-11"])
        self.assertEqual(run_tesseract.call_args.kwargs["psm"], "11")

    @patch("pdf_export_text.ocr_words_for_page")
    @patch("pdf_export_text.native_words")
    def test_page_text_words_prefers_native_content(self, get_native, get_ocr) -> None:
        expected = [word("native", 0)]
        get_native.return_value = expected

        actual = page_text_words(SimpleNamespace(), "temp", "eng", report(), True)

        self.assertIs(actual, expected)
        get_ocr.assert_not_called()

    @patch("pdf_export_text.ocr_words_for_page", side_effect=RuntimeError("offline"))
    @patch("pdf_export_text.native_words", return_value=[])
    def test_page_text_words_reports_ocr_failures(self, _native, _ocr) -> None:
        metrics = report("scanned")
        page = SimpleNamespace(number=2)

        self.assertEqual(page_text_words(page, "temp", "eng", metrics, True), [])
        self.assertIn("page 3: offline", metrics["warnings"][0])

    @patch("pdf_export_text.ocr_words_for_page")
    @patch("pdf_export_text.native_words", return_value=[])
    def test_page_text_words_respects_disabled_or_unresolved_ocr(
        self, _native, get_ocr
    ) -> None:
        page = SimpleNamespace(number=0)
        self.assertEqual(page_text_words(page, "temp", "eng", report(), False), [])
        self.assertEqual(page_text_words(page, "temp", None, report(), True), [])
        get_ocr.assert_not_called()

    def test_update_text_metrics_handles_native_and_scanned_coverage(self) -> None:
        line = TextLine("FileMint", 0, 0, 20, 10, 8)
        native = report()
        update_text_metrics(native, [line])
        self.assertEqual(native["editableTextBoxes"], 1)
        self.assertEqual(native["editableCharacters"], 8)
        self.assertEqual(native["textCoverageEstimate"], 100)

        scanned = report("scanned")
        scanned["ocrTextCandidates"] = 4
        update_text_metrics(scanned, [line])
        self.assertEqual(scanned["textCoverageEstimate"], 16)

    @patch("pdf_export_text.resolve_ocr_language", return_value="eng+rus")
    def test_maybe_resolve_ocr_only_resolves_when_needed(self, resolve) -> None:
        self.assertIsNone(maybe_resolve_ocr("a.pdf", "auto", False, report("scanned")))
        self.assertIsNone(maybe_resolve_ocr("a.pdf", "auto", True, report("native")))
        self.assertEqual(
            maybe_resolve_ocr("a.pdf", "auto", True, report("mixed")), "eng+rus"
        )
        resolve.assert_called_once()

    @patch(
        "pdf_export_text.resolve_ocr_language",
        side_effect=RuntimeError("Tesseract unavailable"),
    )
    def test_maybe_resolve_ocr_turns_resolution_failure_into_warning(
        self, _resolve
    ) -> None:
        metrics = report("scanned")
        self.assertIsNone(maybe_resolve_ocr("a.pdf", "auto", True, metrics))
        self.assertEqual(metrics["warnings"], ["Tesseract unavailable"])


if __name__ == "__main__":
    unittest.main()
