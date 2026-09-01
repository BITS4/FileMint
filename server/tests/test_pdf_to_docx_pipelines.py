from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz

from server.pdf_to_docx_core import exact, image, scan
from server.pdf_to_docx_core.models import LineBox, WordBox
from server.pdf_to_docx_core.reporting import docx_output_stats


TSV = "\n".join(
    [
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
        "5\t1\t1\t1\t1\t1\t20\t30\t80\t20\t95\tEditable",
        "5\t1\t1\t1\t1\t2\t110\t30\t60\t20\t94\tcontent",
    ]
)


def create_pdf(
    path: Path, text: str = "Native editable FileMint document content"
) -> None:
    pdf = fitz.open()
    page = pdf.new_page(width=300, height=200)
    page.insert_text((30, 60), text)
    pdf.save(path)
    pdf.close()


def report() -> dict[str, object]:
    return {"warnings": [], "notes": [], "pagesConverted": 1, "tablesDetected": 0}


def synthetic_lines(
    _image: str,
    _lang: str,
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
    _modes: list[str],
    _report: dict[str, object],
) -> list[LineBox]:
    word = WordBox("Editable OCR content", 20, 30, 150, 20, 96, 1, 1, 1)
    return [
        LineBox(
            word.text,
            [word],
            20,
            30,
            150,
            20,
            96,
            page_width_px,
            page_height_px,
            page_width_pt,
            page_height_pt,
            [(20, 170, word.text)],
        )
    ]


class ConversionPipelineTests(unittest.TestCase):
    def test_layout_ocr_pipeline_builds_editable_word_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "layout.docx"
            create_pdf(source)
            quality = report()
            with patch.object(image, "run_tesseract_tsv", return_value=TSV):
                image.ocr_to_docx_layout(
                    str(source), str(target), "eng", False, quality, quality="low"
                )
            stats = docx_output_stats(str(target))
        self.assertTrue(quality["editableTextDetected"])
        self.assertGreater(stats["outputEditableCharacters"], 10)
        self.assertIn("Tesseract OCR", str(quality["notes"][0]))

    def test_layout_ocr_pipeline_reports_empty_engine_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "empty.docx"
            create_pdf(source)
            quality = report()
            with patch.object(image, "run_tesseract_tsv", return_value=""):
                image.ocr_to_docx_layout(
                    str(source), str(target), "eng", True, quality, quality="low"
                )
        self.assertFalse(quality["editableTextDetected"])
        self.assertTrue(
            any(
                "no editable text" in warning.lower() for warning in quality["warnings"]
            )
        )

    def test_image_only_pipeline_preserves_page_as_noneditable_picture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "image.docx"
            create_pdf(source)
            quality = report()
            image.to_docx_image(
                str(source),
                str(target),
                quality,
                quality="low",
                visual_object_format="jpg",
            )
            stats = docx_output_stats(str(target))
        self.assertTrue(quality["nonEditableVisualFallback"])
        self.assertEqual(stats["outputImages"], 1)

    def test_scan_text_layer_pipeline_rebuilds_native_coordinates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "scan-flow.docx"
            create_pdf(source)
            quality = report()
            scan.to_docx_scan_text_layer(
                str(source), str(target), None, quality, quality="low"
            )
            stats = docx_output_stats(str(target))
        self.assertEqual(quality["resolvedMode"], "scan-text-flow")
        self.assertTrue(quality["editableTextDetected"])
        self.assertGreater(stats["outputEditableCharacters"], 20)

    def test_exact_visual_pipeline_uses_extracted_ocr_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "exact.docx"
            create_pdf(source)
            quality = report()
            with (
                patch.object(exact, "collect_ocr_lines", side_effect=synthetic_lines),
                patch.object(exact, "segment_visual_layer", return_value=([], [])),
            ):
                exact.ocr_to_docx_exact_visual(
                    str(source),
                    str(target),
                    "eng",
                    quality,
                    premium=False,
                    table_detection=False,
                    visible_text=True,
                    quality="low",
                )
            stats = docx_output_stats(str(target))
        self.assertTrue(quality["editableTextDetected"])
        self.assertEqual(quality["editableTextBoxes"], 1)
        self.assertGreater(stats["outputEditableCharacters"], 10)


if __name__ == "__main__":
    unittest.main()
