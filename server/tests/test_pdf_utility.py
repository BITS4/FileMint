"""Tests for PDF page rendering and native/OCR text utility exports."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from server import pdf_to_docx as pdf_to_docx_facade
from server.pdf_to_docx_core.models import LineBox, WordBox

with patch.dict(sys.modules, {"pdf_to_docx": pdf_to_docx_facade}):
    from server import pdf_utility


def report() -> dict[str, object]:
    return {
        "warnings": [],
        "notes": [],
        "ocrPasses": [],
        "ocrTextCandidates": 0,
        "lowConfidenceOcrAreas": 0,
    }


def line(text: str, confidence: float, words: int = 1) -> LineBox:
    boxes = [
        WordBox(f"w{index}", 0, 0, 10, 10, confidence, 1, 1, 1)
        for index in range(words)
    ]
    return LineBox(
        text,
        boxes,
        0,
        0,
        50,
        10,
        confidence,
        100,
        100,
        50,
        50,
        [(0, 50, text)],
    )


class FakePixmap:
    width = 200
    height = 300

    def __init__(self) -> None:
        self.saved: list[tuple[str, dict[str, object]]] = []

    def save(self, path: str, **kwargs: object) -> None:
        Path(path).write_bytes(b"image")
        self.saved.append((path, kwargs))


class FakePage:
    def __init__(self, number: int, text: str = "") -> None:
        self.number = number
        self.text = text
        self.rect = SimpleNamespace(width=100, height=150)
        self.pixmap = FakePixmap()

    def get_pixmap(self, **_kwargs: object) -> FakePixmap:
        return self.pixmap

    def get_text(self, *_args: object, **_kwargs: object) -> str:
        return self.text


def fake_document(pages: list[FakePage]) -> MagicMock:
    document = MagicMock()
    document.__iter__.side_effect = lambda: iter(pages)
    document.__len__.return_value = len(pages)
    return document


class PdfUtilityTests(unittest.TestCase):
    def test_report_maps_inspection_metadata_and_optional_writer(self) -> None:
        info = {
            "pdfType": "mixed",
            "pages": 3,
            "tablesDetected": 2,
            "imagesDetected": 4,
        }
        with patch.object(pdf_utility, "inspect_pdf", return_value=info):
            payload = pdf_utility.make_report("source.pdf", "pdf-images")
        self.assertEqual(payload["pdfType"], "mixed")
        self.assertEqual(payload["visualObjectsPreserved"], 3)
        self.assertEqual(payload["tablesDetected"], 2)

        pdf_utility.write_report(None, payload)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "report.json")
            pdf_utility.write_report(str(path), payload)
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8"))["pagesConverted"], 3
            )

    def test_render_pages_writes_png_and_jpg_archives_with_bounded_dpi(self) -> None:
        for fmt, dpi, expected_quality in (("png", 10, None), ("jpg", 999, 92)):
            with self.subTest(format=fmt):
                pages = [FakePage(0), FakePage(1)]
                document = fake_document(pages)
                quality = report()
                with (
                    tempfile.TemporaryDirectory() as tmp,
                    patch.object(pdf_utility.fitz, "open", return_value=document),
                ):
                    archive = Path(tmp, f"pages-{fmt}.zip")
                    pdf_utility.render_pages(
                        "source.pdf", str(archive), fmt, dpi, quality
                    )
                    self.assertTrue(archive.exists())
                    import zipfile

                    with zipfile.ZipFile(archive) as zipped:
                        self.assertEqual(
                            zipped.namelist(),
                            [f"page-001.{fmt}", f"page-002.{fmt}"],
                        )
                for page in pages:
                    kwargs = page.pixmap.saved[0][1]
                    if expected_quality is None:
                        self.assertEqual(kwargs, {})
                    else:
                        self.assertEqual(kwargs, {"jpg_quality": expected_quality})
                document.close.assert_called_once()
                self.assertIn(fmt.upper(), quality["notes"][0])

    def test_ocr_page_text_tracks_candidates_confidence_and_pass_once(self) -> None:
        page = FakePage(0)
        lines = [line("Low", 20, 2), line("Good", 80), line("", -1)]
        quality = report()
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(pdf_utility, "run_tesseract_tsv", return_value="tsv") as run,
            patch.object(pdf_utility, "parse_tsv", return_value=lines),
        ):
            text = pdf_utility.ocr_page_text(page, tmp, "eng", quality)
            second = pdf_utility.ocr_page_text(page, tmp, "eng", quality)

        self.assertEqual(text, "Low\nGood")
        self.assertEqual(second, text)
        self.assertEqual(quality["ocrTextCandidates"], 8)
        self.assertEqual(quality["lowConfidenceOcrAreas"], 2)
        self.assertEqual(quality["ocrPasses"], ["psm-6"])
        self.assertEqual(run.call_args.kwargs, {"psm": "6"})

    def test_extract_text_prefers_native_content_and_closes_document(self) -> None:
        pages = [FakePage(0, " Native text "), FakePage(1, "")]
        document = fake_document(pages)
        quality = report()
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(pdf_utility.fitz, "open", return_value=document),
            patch.object(pdf_utility, "resolve_ocr_language") as resolve,
        ):
            target = Path(tmp, "native.txt")
            pdf_utility.extract_text("source.pdf", str(target), "auto", quality)
            self.assertEqual(target.read_text(encoding="utf-8"), "Native text")

        resolve.assert_not_called()
        document.close.assert_called_once()
        self.assertTrue(quality["editableTextDetected"])
        self.assertEqual(quality["editableTextBoxes"], 1)
        self.assertEqual(quality["textCoverageEstimate"], 100)

    def test_extract_text_uses_ocr_for_empty_native_pages(self) -> None:
        for ocr_values, expected_coverage in ((["OCR one", ""], 100), (["", ""], 0)):
            with self.subTest(ocr_values=ocr_values):
                pages = [FakePage(0), FakePage(1)]
                document = fake_document(pages)
                quality = report()
                with (
                    tempfile.TemporaryDirectory() as tmp,
                    patch.object(pdf_utility.fitz, "open", return_value=document),
                    patch.object(
                        pdf_utility, "resolve_ocr_language", return_value="eng"
                    ) as resolve,
                    patch.object(pdf_utility, "ocr_page_text", side_effect=ocr_values),
                ):
                    target = Path(tmp, "ocr.txt")
                    pdf_utility.extract_text("source.pdf", str(target), "auto", quality)
                    expected = "OCR one" if ocr_values[0] else ""
                    self.assertEqual(target.read_text(encoding="utf-8"), expected)
                resolve.assert_called_once_with("auto", quality)
                document.close.assert_called_once()
                self.assertEqual(quality["editableTextDetected"], bool(ocr_values[0]))
                self.assertEqual(quality["textCoverageEstimate"], expected_coverage)

    def test_cli_dispatches_both_tasks_and_records_failures(self) -> None:
        base = [
            "pdf_utility",
            "--input",
            "source.pdf",
            "--output",
            "target.out",
        ]
        payload = report()
        with (
            patch.object(
                sys,
                "argv",
                [*base, "--task", "images", "--format", "jpg", "--dpi", "240"],
            ),
            patch.object(pdf_utility, "make_report", return_value=payload),
            patch.object(pdf_utility, "render_pages") as render,
            patch.object(pdf_utility, "write_report") as write,
        ):
            pdf_utility.main()
        render.assert_called_once_with("source.pdf", "target.out", "jpg", 240, payload)
        write.assert_called_once_with(None, payload)

        payload = report()
        with (
            patch.object(
                sys,
                "argv",
                [
                    *base,
                    "--task",
                    "text",
                    "--lang",
                    "rus",
                    "--report",
                    "report.json",
                ],
            ),
            patch.object(pdf_utility, "make_report", return_value=payload),
            patch.object(pdf_utility, "extract_text") as extract,
            patch.object(pdf_utility, "write_report") as write,
        ):
            pdf_utility.main()
        extract.assert_called_once_with("source.pdf", "target.out", "rus", payload)
        write.assert_called_once_with("report.json", payload)

        payload = report()
        with (
            patch.object(sys, "argv", [*base, "--task", "images"]),
            patch.object(pdf_utility, "make_report", return_value=payload),
            patch.object(
                pdf_utility, "render_pages", side_effect=RuntimeError("render failed")
            ),
            patch.object(pdf_utility, "write_report") as write,
            self.assertRaisesRegex(RuntimeError, "render failed"),
        ):
            pdf_utility.main()
        self.assertEqual(payload["warnings"], ["render failed"])
        write.assert_called_once_with(None, payload)


if __name__ == "__main__":
    unittest.main()
