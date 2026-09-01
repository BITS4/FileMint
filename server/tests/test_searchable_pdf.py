"""Deterministic tests for searchable-PDF validation and CLI orchestration."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import fitz

from server import pdf_to_docx as pdf_to_docx_facade

with patch.dict(sys.modules, {"pdf_to_docx": pdf_to_docx_facade}):
    from server import searchable_pdf


class StatsPage:
    def __init__(self, text: str, words: list[tuple[object, ...]]) -> None:
        self.text = text
        self.words = words

    def get_text(self, mode: str) -> object:
        return self.text if mode == "text" else self.words


class SearchablePdfHelpersTests(unittest.TestCase):
    def test_truthy_supports_defaults_booleans_and_common_false_strings(self) -> None:
        self.assertTrue(searchable_pdf.truthy(None))
        self.assertFalse(searchable_pdf.truthy(None, False))
        self.assertTrue(searchable_pdf.truthy(True))
        self.assertFalse(searchable_pdf.truthy(False))
        for value in ("0", "false", "NO", " off "):
            self.assertFalse(searchable_pdf.truthy(value))
        self.assertTrue(searchable_pdf.truthy("yes"))

    def test_text_stats_counts_pages_words_text_pages_and_sample(self) -> None:
        pages = [
            StatsPage("  searchable text  ", [(1,), (2,)]),
            StatsPage("tiny", [(1,)]),
            StatsPage("", []),
        ]
        document = MagicMock(page_count=3)
        document.__iter__.return_value = iter(pages)
        with patch.object(fitz, "open", return_value=document):
            stats = searchable_pdf.text_stats("document.pdf")

        self.assertEqual(stats["characters"], len("searchable text") + len("tiny"))
        self.assertEqual(stats["words"], 3)
        self.assertEqual(stats["textPages"], 1)
        self.assertEqual(stats["pageCharacters"], [15, 4, 0])
        self.assertEqual(stats["sample"], "searchable text\ntiny")
        document.close.assert_called_once()

    def test_report_header_starts_with_stable_empty_metrics(self) -> None:
        report = searchable_pdf.report_header()
        self.assertEqual(report["engine"], "ocrmypdf")
        self.assertEqual(report["resolvedMode"], "searchable-ocr-layer")
        self.assertFalse(report["editableTextDetected"])
        self.assertEqual(report["warnings"], [])

    def test_find_ocrmypdf_prefers_explicit_absolute_then_path_lookup(self) -> None:
        with (
            patch.object(searchable_pdf.os.path, "isabs", return_value=True),
            patch.object(searchable_pdf.os.path, "exists", return_value=True),
            patch.object(searchable_pdf.shutil, "which") as which,
        ):
            self.assertEqual(
                searchable_pdf.find_ocrmypdf("/tools/ocrmypdf"),
                "/tools/ocrmypdf",
            )
        which.assert_not_called()

        with (
            patch.object(searchable_pdf.os.path, "isabs", return_value=False),
            patch.object(
                searchable_pdf.shutil,
                "which",
                side_effect=lambda value: (
                    "/bin/ocrmypdf" if value == "ocrmypdf" else None
                ),
            ),
        ):
            self.assertEqual(searchable_pdf.find_ocrmypdf("custom"), "/bin/ocrmypdf")

        with (
            patch.object(searchable_pdf.os.path, "isabs", return_value=False),
            patch.object(searchable_pdf.shutil, "which", return_value=None),
        ):
            self.assertIsNone(searchable_pdf.find_ocrmypdf())

    def test_run_ocrmypdf_uses_skip_text_without_optional_tools(self) -> None:
        result = SimpleNamespace(stdout="done", stderr="notice")
        with (
            patch.object(searchable_pdf, "find_tesseract", return_value=None),
            patch.object(searchable_pdf, "tessdata_dir_for_lang", return_value=None),
            patch.object(searchable_pdf.subprocess, "run", return_value=result) as run,
        ):
            output = searchable_pdf.run_ocrmypdf(
                "ocrmypdf",
                "source.pdf",
                "target.pdf",
                "sidecar.txt",
                "eng",
                {"textCharacters": 100, "imageBackedPages": 0},
                force=False,
                deskew=False,
                rotate_pages=True,
            )

        self.assertEqual(output, ("done", "notice"))
        command = run.call_args.args[0]
        self.assertIn("--skip-text", command)
        self.assertNotIn("--deskew", command)
        self.assertNotIn("--rotate-pages", command)

    def test_run_ocrmypdf_merges_tessdata_for_force_deskew_and_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / "bin" / "tesseract.exe"
            system_data = binary.parent / "tessdata"
            project_data = root / "project-tessdata"
            merged_data = root / "merged-tessdata"
            system_data.mkdir(parents=True)
            project_data.mkdir()
            merged_data.mkdir()
            binary.write_bytes(b"binary")
            (system_data / "eng.traineddata").write_bytes(b"system-eng")
            (system_data / "pdf.ttf").write_bytes(b"font")
            (system_data / "nested").mkdir()
            (system_data / "nested" / "item.txt").write_text("item", encoding="utf-8")
            (system_data / "ignored.txt").write_text("ignored", encoding="utf-8")
            (project_data / "rus.traineddata").write_bytes(b"project-rus")
            (project_data / "osd.traineddata").write_bytes(b"orientation")
            captured: dict[str, object] = {}

            def run(command: list[str], **kwargs: object) -> SimpleNamespace:
                captured["command"] = command
                captured["env"] = kwargs["env"]
                merged = Path(str(kwargs["env"]["TESSDATA_PREFIX"]))
                captured["files"] = sorted(
                    str(path.relative_to(merged)) for path in merged.rglob("*")
                )
                return SimpleNamespace(stdout="", stderr="")

            with (
                patch.object(
                    searchable_pdf, "find_tesseract", return_value=str(binary)
                ),
                patch.object(
                    searchable_pdf,
                    "tessdata_dir_for_lang",
                    return_value=str(project_data),
                ),
                patch.object(
                    searchable_pdf.tempfile,
                    "mkdtemp",
                    return_value=str(merged_data),
                ),
                patch.object(searchable_pdf.subprocess, "run", side_effect=run),
            ):
                searchable_pdf.run_ocrmypdf(
                    "ocrmypdf",
                    "source.pdf",
                    "target.pdf",
                    "sidecar.txt",
                    "rus",
                    {"textCharacters": 100, "imageBackedPages": 1},
                    force=False,
                    deskew=True,
                    rotate_pages=True,
                )

            command = captured["command"]
            self.assertIn("--deskew", command)
            self.assertIn("--force-ocr", command)
            self.assertIn("--rotate-pages", command)
            self.assertIn("rus.traineddata", captured["files"])
            self.assertIn("eng.traineddata", captured["files"])
            normalized_files = [value.replace("\\", "/") for value in captured["files"]]
            self.assertIn("nested/item.txt", normalized_files)
            self.assertFalse(merged_data.exists())
            self.assertTrue(str(captured["env"]["PATH"]).startswith(str(binary.parent)))

    def test_run_ocrmypdf_forced_mode_and_system_osd_without_project_data(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp, "bin", "tesseract")
            data = binary.parent / "tessdata"
            data.mkdir(parents=True)
            binary.write_bytes(b"binary")
            (data / "osd.traineddata").write_bytes(b"osd")
            with (
                patch.object(
                    searchable_pdf, "find_tesseract", return_value=str(binary)
                ),
                patch.object(
                    searchable_pdf, "tessdata_dir_for_lang", return_value=None
                ),
                patch.object(
                    searchable_pdf.subprocess,
                    "run",
                    return_value=SimpleNamespace(stdout=None, stderr=None),
                ) as run,
            ):
                output = searchable_pdf.run_ocrmypdf(
                    "ocrmypdf",
                    "source.pdf",
                    "target.pdf",
                    "sidecar.txt",
                    "eng",
                    {"textCharacters": 100, "imageBackedPages": 0},
                    force=True,
                    deskew=False,
                    rotate_pages=True,
                )
        self.assertEqual(output, ("", ""))
        self.assertIn("--force-ocr", run.call_args.args[0])
        self.assertIn("--rotate-pages", run.call_args.args[0])


class SearchablePdfCliTests(unittest.TestCase):
    def invoke(
        self,
        *,
        input_info: dict[str, object] | None = None,
        input_stats: dict[str, object] | None = None,
        output_stats: dict[str, object] | None = None,
        force: str = "auto",
        stderr: str = "",
        stdout: str = "",
        sidecar: str | None = "recognized words",
        create_output: bool = True,
        include_report: bool = True,
        find_engine: str | None = "ocrmypdf",
    ) -> tuple[int, dict[str, object], MagicMock]:
        input_info = input_info or {
            "pdfType": "scanned",
            "pages": 2,
            "textCharacters": 0,
            "imageBackedPages": 2,
        }
        input_stats = input_stats or {
            "pages": 2,
            "characters": 0,
            "words": 0,
            "textPages": 0,
        }
        output_stats = output_stats or {
            "pages": 2,
            "characters": 120,
            "words": 24,
            "textPages": 2,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            working = root / "working"
            working.mkdir()
            output = root / "output.pdf"
            report_path = root / "report.json"
            argv = [
                "searchable_pdf",
                "--input",
                "source.pdf",
                "--output",
                str(output),
                "--force",
                force,
            ]
            if include_report:
                argv.extend(["--report", str(report_path)])

            def run_engine(
                _engine: str,
                _source: str,
                destination: str,
                sidecar_path: str,
                _lang: str,
                _info: dict[str, object],
                **_options: object,
            ) -> tuple[str, str]:
                if create_output:
                    Path(destination).write_bytes(b"pdf")
                if sidecar is not None:
                    Path(sidecar_path).write_text(sidecar, encoding="utf-8")
                return stdout, stderr

            with (
                patch.object(sys, "argv", argv),
                patch.object(searchable_pdf.sys, "stderr", io.StringIO()),
                patch.object(
                    searchable_pdf.tempfile,
                    "mkdtemp",
                    return_value=str(working),
                ),
                patch.object(searchable_pdf, "inspect_pdf", return_value=input_info),
                patch.object(
                    searchable_pdf,
                    "text_stats",
                    side_effect=[input_stats, output_stats],
                ),
                patch.object(
                    searchable_pdf, "resolve_ocr_language", return_value="eng"
                ) as resolve,
                patch.object(searchable_pdf, "find_ocrmypdf", return_value=find_engine),
                patch.object(
                    searchable_pdf, "run_ocrmypdf", side_effect=run_engine
                ) as run,
            ):
                code = searchable_pdf.main()
                internal_report = resolve.call_args.args[1]
            if include_report and report_path.exists():
                payload = json.loads(report_path.read_text(encoding="utf-8"))
            else:
                payload = internal_report
        return code, payload, run

    def test_scanned_auto_force_success_validates_layer_and_filters_noise(self) -> None:
        stderr = "\n".join(
            [
                "WinError 2 helper missing",
                "Image optimization ratio 1.0",
                "Parsing page 1",
                "Postprocessing",
                "Output file is a PDF",
                "Auto mode: enabled",
                "Consider using the pymupdf_layout package",
                "real OCR warning",
            ]
        )
        code, payload, run = self.invoke(stderr=stderr)

        self.assertEqual(code, 0)
        self.assertTrue(run.call_args.kwargs["force"])
        self.assertTrue(payload["hiddenTextLayer"])
        self.assertFalse(payload["visibleEditableTextLayer"])
        self.assertEqual(payload["textCoverageEstimate"], 100)
        self.assertEqual(payload["ocrTextCandidates"], 24)
        self.assertEqual(payload["ocrPasses"], ["ocrmypdf/force-ocr"])
        self.assertEqual(payload["warnings"], ["real OCR warning"])
        self.assertTrue(any("Windows helper" in note for note in payload["notes"]))

    def test_existing_text_auto_skips_force_and_report_file_is_optional(self) -> None:
        info = {
            "pdfType": "digital",
            "pages": 1,
            "textCharacters": 200,
            "imageBackedPages": 0,
        }
        input_stats = {"pages": 1, "characters": 200, "words": 30, "textPages": 1}
        output_stats = {"pages": 1, "characters": 210, "words": 31, "textPages": 1}
        code, payload, run = self.invoke(
            input_info=info,
            input_stats=input_stats,
            output_stats=output_stats,
            sidecar=None,
            include_report=False,
        )

        self.assertEqual(code, 0)
        self.assertFalse(run.call_args.kwargs["force"])
        self.assertEqual(payload["resolvedMode"], "already-searchable-or-mixed")
        self.assertTrue(payload["visibleEditableTextLayer"])
        self.assertFalse(payload["hiddenTextLayer"])
        self.assertEqual(payload["ocrPasses"], ["ocrmypdf/skip-text"])

    def test_explicit_false_force_overrides_auto_detection(self) -> None:
        code, payload, run = self.invoke(force="false", sidecar="one two three")
        self.assertEqual(code, 0)
        self.assertFalse(run.call_args.kwargs["force"])
        self.assertEqual(payload["ocrTextCandidates"], 24)

    def test_missing_engine_and_missing_output_return_failure_reports(self) -> None:
        code, payload, run = self.invoke(find_engine=None)
        self.assertEqual(code, 1)
        run.assert_not_called()
        self.assertIn("not installed", payload["warnings"][-1])

        for stdout, stderr, expected in (
            ("", "engine stderr", "engine stderr"),
            ("engine stdout", "", "engine stdout"),
            ("", "", "did not create"),
        ):
            with self.subTest(expected=expected):
                code, payload, _run = self.invoke(
                    create_output=False, stdout=stdout, stderr=stderr
                )
                self.assertEqual(code, 1)
                self.assertIn(expected, payload["warnings"][-1])

    def test_empty_verified_output_is_rejected(self) -> None:
        empty = {"pages": 1, "characters": 0, "words": 0, "textPages": 0}
        code, payload, _run = self.invoke(
            input_stats=empty,
            output_stats=empty,
            sidecar="",
        )
        self.assertEqual(code, 1)
        self.assertIn("no searchable text layer", payload["warnings"][-1])

    def test_error_without_report_and_report_write_failure_are_safe(self) -> None:
        code, payload, _run = self.invoke(find_engine=None, include_report=False)
        self.assertEqual(code, 1)
        self.assertIn("not installed", payload["warnings"][-1])

        argv = [
            "searchable_pdf",
            "--input",
            "source.pdf",
            "--output",
            "output.pdf",
            "--report",
            "report.json",
        ]
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(sys, "argv", argv),
            patch.object(searchable_pdf.sys, "stderr", io.StringIO()),
            patch.object(
                searchable_pdf.tempfile, "mkdtemp", return_value=str(Path(tmp, "work"))
            ),
            patch.object(
                searchable_pdf, "inspect_pdf", side_effect=RuntimeError("bad input")
            ),
            patch.object(Path, "write_text", side_effect=OSError("read-only")),
        ):
            Path(tmp, "work").mkdir()
            self.assertEqual(searchable_pdf.main(), 1)


if __name__ == "__main__":
    unittest.main()
