"""Behavior-focused edge coverage for OCR runtime discovery and PDF inspection."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from server.pdf_to_docx_core import runtime


class FakePage:
    def __init__(
        self,
        number: int,
        text: str,
        images: list[tuple[int]],
        drawings: int,
        *,
        coverage: float = 0.0,
        table_count: int = 0,
        image_rect_error: bool = False,
        table_error: bool = False,
    ) -> None:
        self.number = number
        self._text = text
        self._images = images
        self._drawings = drawings
        self._coverage = coverage
        self._table_count = table_count
        self._image_rect_error = image_rect_error
        self._table_error = table_error
        self.rect = SimpleNamespace(width=100.0, height=200.0)

    def get_text(self, _kind: str) -> str:
        return self._text

    def get_images(self, *, full: bool) -> list[tuple[int]]:
        self.full_requested = full
        return self._images

    def get_image_rects(self, _xref: int) -> list[SimpleNamespace]:
        if self._image_rect_error:
            raise RuntimeError("broken image metadata")
        return [SimpleNamespace(width=100.0, height=200.0 * self._coverage)]

    def get_drawings(self) -> list[object]:
        return [object()] * self._drawings

    def find_tables(self) -> SimpleNamespace:
        if self._table_error:
            raise RuntimeError("table detector unavailable")
        return SimpleNamespace(tables=[object()] * self._table_count)


class FakeDocument:
    def __init__(self, pages: list[FakePage]) -> None:
        self.pages = pages
        self.closed = False

    def __iter__(self):
        return iter(self.pages)

    def __len__(self) -> int:
        return len(self.pages)

    def close(self) -> None:
        self.closed = True


class RuntimeEdgeTests(unittest.TestCase):
    def test_tesseract_discovery_checks_known_locations_then_returns_none(self) -> None:
        with (
            patch.object(runtime.shutil, "which", return_value=None),
            patch.object(
                runtime.os.path,
                "isfile",
                side_effect=lambda path: path == "/opt/homebrew/bin/tesseract",
            ),
        ):
            self.assertEqual(runtime.find_tesseract(), "/opt/homebrew/bin/tesseract")

        with (
            patch.object(runtime.shutil, "which", return_value=None),
            patch.object(runtime.os.path, "isfile", return_value=False),
        ):
            self.assertIsNone(runtime.find_tesseract())

    def test_local_and_installed_language_sets_handle_missing_directories(self) -> None:
        with patch.object(runtime.os.path, "isdir", return_value=False):
            self.assertEqual(runtime.local_tesseract_languages(), set())
        with (
            patch.object(runtime, "system_tesseract_languages", return_value={"eng"}),
            patch.object(runtime, "local_tesseract_languages", return_value={"tgk"}),
        ):
            self.assertEqual(
                runtime.installed_tesseract_languages("tesseract"), {"eng", "tgk"}
            )

    def test_checksum_reads_complete_model_and_validation_rejects_unknown_models(
        self,
    ) -> None:
        payload = (b"trusted-model" * 100_000) + b"tail"
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp, "eng.traineddata")
            model.write_bytes(payload)
            self.assertEqual(
                runtime.tessdata_checksum(str(model)),
                hashlib.sha256(payload).hexdigest(),
            )
            with patch.object(runtime, "TESSDATA_FAST_SHA256", {}):
                self.assertFalse(runtime.valid_project_tessdata(str(model), "eng"))

    def test_ensure_model_short_circuits_installed_and_rejects_unsupported(
        self,
    ) -> None:
        report: dict[str, list[str]] = {"notes": [], "warnings": []}
        with patch.object(
            runtime, "installed_tesseract_languages", return_value={"eng"}
        ):
            self.assertTrue(runtime.ensure_project_tessdata("eng", report))
        with (
            patch.object(runtime, "installed_tesseract_languages", return_value=set()),
            patch.object(runtime, "DOWNLOADABLE_TESSDATA", {"fas"}),
        ):
            self.assertFalse(runtime.ensure_project_tessdata("unknown", report))
        self.assertEqual(report, {"notes": [], "warnings": []})

    def test_failed_model_download_warns_even_when_temporary_cleanup_fails(
        self,
    ) -> None:
        report: dict[str, list[str]] = {"notes": [], "warnings": []}
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(runtime, "LOCAL_TESSDATA_DIR", tmp),
            patch.object(runtime, "DOWNLOADABLE_TESSDATA", {"fas"}),
            patch.object(runtime, "TESSDATA_FAST_SHA256", {"fas": "0" * 64}),
            patch.object(runtime, "installed_tesseract_languages", return_value=set()),
            patch.object(runtime, "valid_project_tessdata", return_value=False),
            patch.object(
                runtime.urllib.request,
                "urlretrieve",
                side_effect=OSError("network unavailable"),
            ),
            patch.object(runtime.os.path, "exists", return_value=True),
            patch.object(runtime.os, "remove", side_effect=PermissionError("locked")),
        ):
            self.assertFalse(runtime.ensure_project_tessdata("fas", report))
        self.assertIn("network unavailable", report["warnings"][0])

    def test_bulk_model_ensure_skips_empty_and_orientation_entries(self) -> None:
        with patch.object(runtime, "ensure_project_tessdata") as ensure:
            runtime.ensure_project_tessdata_many(["", "osd", "eng", "tgk"], {})
        self.assertEqual(
            [call.args[0] for call in ensure.call_args_list], ["eng", "tgk"]
        )

    def test_project_tessdata_directory_requires_every_requested_language(self) -> None:
        with patch.object(
            runtime, "local_tesseract_languages", return_value={"eng", "rus"}
        ):
            self.assertEqual(
                runtime.tessdata_dir_for_lang("eng+rus+osd"), runtime.LOCAL_TESSDATA_DIR
            )
            self.assertIsNone(runtime.tessdata_dir_for_lang("eng+tgk"))
            self.assertIsNone(runtime.tessdata_dir_for_lang("osd"))

    def test_language_resolution_fails_without_engine(self) -> None:
        with (
            patch.object(runtime, "find_tesseract", return_value=None),
            self.assertRaisesRegex(RuntimeError, "not installed"),
        ):
            runtime.resolve_ocr_language("eng", {"notes": [], "warnings": []})

    def test_local_auto_language_downloads_models_and_chooses_available_pack(
        self,
    ) -> None:
        report: dict[str, object] = {"notes": [], "warnings": []}
        with (
            patch.object(runtime, "find_tesseract", return_value="tesseract"),
            patch.object(runtime, "FAST_HOSTED_OCR", False),
            patch.object(runtime, "ensure_project_tessdata_many") as ensure,
            patch.object(
                runtime, "installed_tesseract_languages", return_value={"rus"}
            ),
            patch.object(runtime, "local_tesseract_languages", return_value={"rus"}),
        ):
            self.assertEqual(runtime.resolve_ocr_language("auto", report), "rus")
        ensure.assert_called_once_with(runtime.OCR_AUTO_DOWNLOAD_LANGS, report)
        self.assertIn("project language data: rus", str(report["notes"][-1]))

    def test_auto_language_uses_stable_fallback_when_engine_cannot_list_models(
        self,
    ) -> None:
        report: dict[str, object] = {"notes": [], "warnings": []}
        with (
            patch.object(runtime, "find_tesseract", return_value="tesseract"),
            patch.object(runtime, "FAST_HOSTED_OCR", True),
            patch.object(runtime, "installed_tesseract_languages", return_value=set()),
            patch.object(runtime, "local_tesseract_languages", return_value=set()),
        ):
            self.assertEqual(runtime.resolve_ocr_language("auto", report), "eng+rus")
        self.assertIn("using eng+rus", str(report["warnings"][0]))

    def test_manual_language_falls_back_when_no_requested_pack_is_installed(
        self,
    ) -> None:
        report: dict[str, object] = {"notes": [], "warnings": []}
        with (
            patch.object(runtime, "find_tesseract", return_value="tesseract"),
            patch.object(runtime, "FAST_HOSTED_OCR", True),
            patch.object(
                runtime, "installed_tesseract_languages", return_value={"deu"}
            ),
            patch.object(runtime, "local_tesseract_languages", return_value=set()),
        ):
            self.assertEqual(runtime.resolve_ocr_language("tgk", report), "deu")
        self.assertEqual(report["ocrLanguage"], "deu")
        self.assertTrue(any("Falling back" in item for item in report["warnings"]))

    def test_manual_language_is_preserved_when_language_listing_is_unavailable(
        self,
    ) -> None:
        report: dict[str, object] = {"notes": [], "warnings": []}
        with (
            patch.object(runtime, "find_tesseract", return_value="tesseract"),
            patch.object(runtime, "FAST_HOSTED_OCR", True),
            patch.object(runtime, "installed_tesseract_languages", return_value=set()),
            patch.object(runtime, "local_tesseract_languages", return_value=set()),
        ):
            self.assertEqual(runtime.resolve_ocr_language("eng,rus", report), "eng+rus")

    def test_pdf_inspection_reports_mixed_image_backed_and_vector_pages(self) -> None:
        pages = [
            FakePage(
                0,
                "",
                [(1,)],
                25,
                coverage=0.8,
                image_rect_error=False,
                table_error=True,
            ),
            FakePage(
                1,
                "This is a native text layer with more than twenty-five characters.",
                [(2,), (3,)],
                2,
                coverage=0.7,
                table_count=2,
                image_rect_error=True,
            ),
        ]
        document = FakeDocument(pages)
        with patch("fitz.open", return_value=document):
            result = runtime.inspect_pdf("mixed.pdf")

        self.assertTrue(document.closed)
        self.assertEqual(result["pdfType"], "mixed")
        self.assertEqual(result["imagePages"], 1)
        self.assertEqual(result["imageBackedPages"], 1)
        self.assertEqual(result["tablesDetected"], 2)
        self.assertEqual(result["vectorPages"], 1)
        self.assertTrue(result["pageDetails"][0]["scannedLikely"])

    def test_pdf2docx_adapter_closes_converter_and_records_editability(self) -> None:
        converter = MagicMock()
        report: dict[str, object] = {"notes": []}
        with patch("pdf2docx.Converter", return_value=converter):
            runtime.to_docx_pdf2docx("source.pdf", "target.docx", report)
        converter.convert.assert_called_once_with("target.docx")
        converter.close.assert_called_once_with()
        self.assertTrue(report["editableTextDetected"])
        self.assertIn("Digital PDF converted", str(report["notes"][0]))


if __name__ == "__main__":
    unittest.main()
