from __future__ import annotations

import unittest

from server.pdf_to_docx_config import (
    clean_choice,
    effective_ocr_request,
    engine_mode,
    is_fast_hosted_ocr,
    quality_dpi,
    safe_mode,
    truthy,
)


class PdfToDocxConfigTests(unittest.TestCase):
    def test_truthy_uses_default_only_for_missing_values(self) -> None:
        self.assertTrue(truthy(None))
        self.assertFalse(truthy(None, False))

    def test_truthy_recognizes_common_false_values(self) -> None:
        for value in ("0", "false", "NO", " off "):
            with self.subTest(value=value):
                self.assertFalse(truthy(value))

    def test_safe_mode_normalizes_premium_aliases(self) -> None:
        for value in ("premium", "PRO", "editable", "high_accuracy"):
            with self.subTest(value=value):
                self.assertEqual(safe_mode(value), "high-accuracy")

    def test_safe_mode_falls_back_to_hybrid(self) -> None:
        self.assertEqual(safe_mode("unsupported"), "hybrid")
        self.assertEqual(safe_mode(""), "hybrid")

    def test_engine_mode_maps_editable_modes_to_premium(self) -> None:
        self.assertEqual(engine_mode("high-accuracy"), "premium")
        self.assertEqual(engine_mode("hybrid"), "premium")
        self.assertEqual(engine_mode("image"), "image")

    def test_clean_choice_rejects_unknown_values(self) -> None:
        self.assertEqual(clean_choice(" JPG ", {"png", "jpg"}, "png"), "jpg")
        self.assertEqual(clean_choice("gif", {"png", "jpg"}, "png"), "png")

    def test_quality_dpi_maps_profiles(self) -> None:
        self.assertEqual(quality_dpi("low", fast_hosted=False), 160)
        self.assertEqual(quality_dpi("medium", fast_hosted=False), 220)
        self.assertEqual(quality_dpi("original", fast_hosted=False), 360)

    def test_quality_dpi_caps_hosted_workloads(self) -> None:
        self.assertEqual(quality_dpi("original", fast_hosted=True), 72)
        self.assertEqual(quality_dpi("high", 240, fast_hosted=True), 72)

    def test_effective_ocr_request_warns_when_manual_language_is_missing(self) -> None:
        report: dict[str, list[str]] = {"warnings": []}
        self.assertEqual(effective_ocr_request("auto", False, report), "eng")
        self.assertEqual(len(report["warnings"]), 1)

    def test_effective_ocr_request_preserves_selected_language(self) -> None:
        report: dict[str, list[str]] = {"warnings": []}
        self.assertEqual(effective_ocr_request("tgk", False, report), "tgk")
        self.assertEqual(effective_ocr_request("auto", True, report), "auto")
        self.assertEqual(report["warnings"], [])

    def test_fast_hosted_detection_is_explicit(self) -> None:
        self.assertTrue(is_fast_hosted_ocr({"FILEMINT_FAST_HOSTED_OCR": "true"}))
        self.assertTrue(is_fast_hosted_ocr({"RENDER": "true"}))
        self.assertFalse(is_fast_hosted_ocr({}))


if __name__ == "__main__":
    unittest.main()
