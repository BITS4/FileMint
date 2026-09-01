"""Deterministic branch coverage for PDF-to-DOCX command orchestration."""

from __future__ import annotations

import sys
import unittest
from collections.abc import Callable
from contextlib import ExitStack
from typing import Any
from unittest.mock import MagicMock, patch

from server.pdf_to_docx_core import cli


def pdf_info(**overrides: Any) -> dict[str, Any]:
    info: dict[str, Any] = {
        "pdfType": "digital",
        "pages": 1,
        "textPages": 1,
        "textCharacters": 700,
        "imageBackedPages": 0,
        "tablesDetected": 0,
        "imagesDetected": 0,
        "pageDetails": [],
    }
    info.update(overrides)
    return info


class CliHarness:
    patched_names = (
        "ensure_output",
        "image_backed_text_layer_likely",
        "image_backed_text_layer_needs_ocr",
        "merge_output_stats",
        "ocr_to_docx_exact_visual",
        "ocr_to_docx_layout",
        "repair_empty_editable_output",
        "resolve_ocr_language",
        "to_docx_digital_text_flow",
        "to_docx_image",
        "to_docx_pdf2docx",
        "to_docx_scan_text_layer",
        "write_report",
    )

    def invoke(
        self,
        *,
        mode: str = "hybrid",
        info: dict[str, Any] | None = None,
        extra_args: list[str] | None = None,
        stats: dict[str, int] | list[dict[str, int]] | None = None,
        configure: Callable[[dict[str, MagicMock]], None] | None = None,
    ) -> tuple[dict[str, MagicMock], dict[str, Any]]:
        argv = [
            "pdf_to_docx",
            "--input",
            "source.pdf",
            "--output",
            "target.docx",
            "--mode",
            mode,
            "--report",
            "report.json",
            *(extra_args or []),
        ]
        default_stats = {
            "outputEditableCharacters": 50,
            "outputTables": 0,
        }
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", argv))
            stack.enter_context(patch("builtins.print"))
            stack.enter_context(
                patch.object(cli, "inspect_pdf", return_value=info or pdf_info())
            )
            mocks = {
                name: stack.enter_context(patch.object(cli, name))
                for name in self.patched_names
            }
            mocks["image_backed_text_layer_likely"].return_value = False
            mocks["image_backed_text_layer_needs_ocr"].return_value = False
            mocks["resolve_ocr_language"].return_value = "eng"
            if isinstance(stats, list):
                mocks["merge_output_stats"].side_effect = stats
            else:
                mocks["merge_output_stats"].return_value = stats or default_stats
            if configure:
                configure(mocks)
            cli.main()
            report = mocks["write_report"].call_args.args[1]
        return mocks, report


class PdfToDocxCliTests(unittest.TestCase, CliHarness):
    def test_premium_digital_text_flow_and_option_normalization(self) -> None:
        mocks, report = self.invoke(
            extra_args=[
                "--visual-object-format",
                "jpeg",
                "--docx-quality",
                "invalid",
                "--auto-detect-language",
                "false",
                "--lang",
                "auto",
                "--table-detection",
                "false",
                "--keep-visual-objects",
                "false",
            ]
        )

        mocks["to_docx_digital_text_flow"].assert_called_once_with(
            "source.pdf", "target.docx", report
        )
        self.assertEqual(report["visualObjectFormat"], "jpg")
        self.assertEqual(report["docxQuality"], "high")
        self.assertFalse(report["tableDetectionEnabled"])
        self.assertFalse(report["keepVisualObjects"])
        self.assertIn("English OCR", report["warnings"][0])

    def test_image_backed_text_layer_routes_to_scan_reconstruction(self) -> None:
        for mode, needs_ocr, resolved_language in (
            ("hybrid", False, "eng"),
            ("exact", False, None),
        ):
            with self.subTest(mode=mode):
                mocks, report = self.invoke(
                    mode=mode,
                    configure=lambda values: setattr(
                        values["image_backed_text_layer_likely"], "return_value", True
                    ),
                )
                args = mocks["to_docx_scan_text_layer"].call_args
                self.assertEqual(
                    args.args[:3], ("source.pdf", "target.docx", resolved_language)
                )
                self.assertEqual(args.kwargs["premium"], mode == "hybrid")
                self.assertIn("full-page scan images", report["warnings"][0])
                if not needs_ocr and mode == "exact":
                    mocks["resolve_ocr_language"].assert_not_called()

    def test_image_backed_ocr_failure_is_reported_but_scan_still_runs(self) -> None:
        def configure(mocks: dict[str, MagicMock]) -> None:
            mocks["image_backed_text_layer_likely"].return_value = True
            mocks["image_backed_text_layer_needs_ocr"].return_value = True
            mocks["resolve_ocr_language"].side_effect = RuntimeError("missing OCR")

        mocks, report = self.invoke(mode="exact", configure=configure)

        mocks["to_docx_scan_text_layer"].assert_called_once()
        self.assertIsNone(mocks["to_docx_scan_text_layer"].call_args.args[2])
        self.assertTrue(any("missing OCR" in warning for warning in report["warnings"]))

    def test_digital_files_with_objects_use_editable_object_converter(self) -> None:
        info = pdf_info(imagesDetected=1, textCharacters=200)
        for mode, expected_note in (
            ("hybrid", "High Accuracy/Hybrid"),
            ("exact", "Exact Visual Mode"),
        ):
            with self.subTest(mode=mode):
                mocks, report = self.invoke(mode=mode, info=info)
                mocks["to_docx_pdf2docx"].assert_called_once_with(
                    "source.pdf", "target.docx", report
                )
                self.assertIn(expected_note, report["notes"][0])

    def test_scanned_editable_modes_choose_visual_ocr_and_resolved_labels(self) -> None:
        info = pdf_info(
            pdfType="scanned", textPages=0, textCharacters=0, imagesDetected=1
        )
        expected = {
            "hybrid": "hybrid-ocr-editable-visual",
            "high-accuracy": "high-accuracy-ocr-editable-visual",
            "exact": "exact-ocr-visual",
        }
        for mode, resolved in expected.items():
            with self.subTest(mode=mode):
                mocks, report = self.invoke(mode=mode, info=info)
                mocks["ocr_to_docx_exact_visual"].assert_called_once()
                self.assertEqual(report["resolvedMode"], resolved)
                self.assertTrue(any("scanned" in value for value in report["warnings"]))

    def test_explicit_ocr_routes_by_layout_preference(self) -> None:
        neutral = pdf_info(
            pdfType="unknown", textPages=0, textCharacters=0, imagesDetected=0
        )
        mocks, report = self.invoke(mode="ocr", info=neutral)
        mocks["ocr_to_docx_exact_visual"].assert_called_once()
        self.assertEqual(report["resolvedMode"], "ocr-editable-visual")

        mocks, report = self.invoke(
            mode="ocr",
            info=neutral,
            extra_args=["--preserve-layout", "false"],
        )
        mocks["ocr_to_docx_layout"].assert_called_once()
        self.assertEqual(report["resolvedMode"], "ocr")

    def test_image_and_default_fallback_modes(self) -> None:
        neutral = pdf_info(
            pdfType="unknown", textPages=0, textCharacters=0, imagesDetected=0
        )
        mocks, report = self.invoke(
            mode="image",
            info=neutral,
            extra_args=["--visual-object-format", "jpg", "--docx-quality", "low"],
        )
        mocks["to_docx_image"].assert_called_once_with(
            "source.pdf",
            "target.docx",
            report,
            quality="low",
            visual_object_format="jpg",
        )
        self.assertEqual(report["resolvedMode"], "image")

        mocks, report = self.invoke(mode="hybrid", info=neutral)
        mocks["to_docx_pdf2docx"].assert_called_once_with(
            "source.pdf", "target.docx", report
        )
        self.assertEqual(report["resolvedMode"], "high-accuracy")

    def test_empty_editable_output_is_repaired_and_rechecked(self) -> None:
        empty = {"outputEditableCharacters": 0, "outputTables": 0}
        repaired = {"outputEditableCharacters": 40, "outputTables": 0}
        mocks, report = self.invoke(stats=[empty, repaired])

        mocks["repair_empty_editable_output"].assert_called_once_with(
            "source.pdf", "target.docx", "auto", True, report, "high", True
        )
        self.assertEqual(mocks["ensure_output"].call_count, 2)
        self.assertEqual(mocks["merge_output_stats"].call_count, 2)

    def test_still_empty_output_raises_and_writes_failure_report(self) -> None:
        empty = {"outputEditableCharacters": 0, "outputTables": 0}
        with self.assertRaisesRegex(RuntimeError, "no editable text"):
            self.invoke(stats=[empty, empty])

    def test_hosted_timeout_visual_fallback_skips_empty_output_repair(self) -> None:
        empty = {"outputEditableCharacters": 0, "outputTables": 0}

        def mark_timeout(_source: str, _target: str, report: dict[str, Any]) -> None:
            report["hostedOcrTimedOut"] = True

        mocks, _report = self.invoke(
            stats=empty,
            configure=lambda values: setattr(
                values["to_docx_digital_text_flow"], "side_effect", mark_timeout
            ),
        )
        mocks["repair_empty_editable_output"].assert_not_called()

    def test_inspection_failure_writes_report_before_reraising(self) -> None:
        argv = [
            "pdf_to_docx",
            "--input",
            "source.pdf",
            "--output",
            "target.docx",
            "--report",
            "report.json",
        ]
        with (
            patch.object(sys, "argv", argv),
            patch.object(cli, "inspect_pdf", side_effect=ValueError("bad PDF")),
            patch.object(cli, "write_report") as write_report,
            self.assertRaisesRegex(ValueError, "bad PDF"),
        ):
            cli.main()
        report = write_report.call_args.args[1]
        self.assertIn("bad PDF", report["warnings"])


if __name__ == "__main__":
    unittest.main()
