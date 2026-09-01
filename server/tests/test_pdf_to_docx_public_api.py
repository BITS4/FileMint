from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import json
from pathlib import Path

import server.pdf_to_docx as public_api


ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"


class PdfToDocxCompatibilityTests(unittest.TestCase):
    def test_facade_reexports_historical_helpers(self) -> None:
        for name in (
            "inspect_pdf",
            "parse_tsv",
            "resolve_ocr_language",
            "run_tesseract_tsv",
            "find_tesseract",
            "tessdata_dir_for_lang",
            "docx_output_stats",
            "main",
        ):
            with self.subTest(name=name):
                self.assertTrue(callable(getattr(public_api, name)))

    def test_facade_reexports_geometry_types(self) -> None:
        self.assertTrue(hasattr(public_api, "PdfLine"))
        self.assertTrue(hasattr(public_api, "PdfSpan"))
        self.assertTrue(hasattr(public_api, "LineBox"))
        self.assertTrue(hasattr(public_api, "WordBox"))

    def test_direct_script_entrypoint_preserves_cli_help(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SERVER / "pdf_to_docx.py"), "--help"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--auto-detect-language", result.stdout)
        self.assertIn("--keep-visual-objects", result.stdout)

    def test_direct_cli_converts_native_pdf_and_writes_quality_report(self) -> None:
        import fitz

        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "output.docx"
            report = Path(tmp) / "report.json"
            pdf = fitz.open()
            page = pdf.new_page(width=300, height=200)
            page.insert_text((30, 60), "FileMint command line native PDF conversion")
            pdf.save(source)
            pdf.close()

            result = subprocess.run(
                [
                    sys.executable,
                    str(SERVER / "pdf_to_docx.py"),
                    "--input",
                    str(source),
                    "--output",
                    str(target),
                    "--mode",
                    "high-accuracy",
                    "--report",
                    str(report),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(target.exists())
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertGreater(payload["outputEditableCharacters"], 20)
            self.assertEqual(payload["resolvedMode"], "high-accuracy")

    def test_companion_python_tools_can_import_the_facade_from_server_directory(
        self,
    ) -> None:
        command = (
            "from pdf_export_model import make_report; "
            "from pdf_to_docx import inspect_pdf, parse_tsv; "
            "from searchable_pdf import text_stats; "
            "assert callable(make_report) and callable(inspect_pdf) and callable(parse_tsv) and callable(text_stats)"
        )
        result = subprocess.run(
            [sys.executable, "-c", command],
            cwd=SERVER,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
