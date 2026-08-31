"""Tests for PDF export models and report generation."""

import os
import sys
import unittest
from unittest.mock import patch

SERVER_DIR = os.path.dirname(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from pdf_export_model import clean_text, make_report, points_to_emu


class PdfExportModelTests(unittest.TestCase):
    def test_clean_text_removes_nulls_and_collapses_whitespace(self) -> None:
        self.assertEqual(clean_text("  hello\x00  world\n"), "hello world")

    def test_points_to_emu_uses_office_units(self) -> None:
        self.assertEqual(points_to_emu(72), 914400)

    @patch("pdf_export_model.inspect_pdf")
    def test_make_report_carries_detection_metrics(self, inspect_pdf) -> None:
        inspect_pdf.return_value = {
            "pdfType": "native",
            "pages": 3,
            "tablesDetected": 2,
            "imagesDetected": 4,
        }

        report = make_report("source.pdf", "xlsx")

        self.assertEqual(report["resolvedMode"], "premium-pdf-to-xlsx")
        self.assertEqual(report["pagesConverted"], 3)
        self.assertEqual(report["tablesDetected"], 2)
        self.assertEqual(report["imagesDetected"], 4)
        self.assertFalse(report["nonEditableVisualFallback"])


if __name__ == "__main__":
    unittest.main()
