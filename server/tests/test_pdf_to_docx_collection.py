"""Deterministic branch coverage for OCR collection and region orchestration."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.pdf_to_docx_core import collection
from server.pdf_to_docx_core.models import LineBox, WordBox


def line(text: str, *, left: float = 10, top: float = 20) -> LineBox:
    word = WordBox(text, left, top, 30, 10, 90, 1, 1, 1)
    return LineBox(
        text=text,
        words=[word],
        left=left,
        top=top,
        width=30,
        height=10,
        conf=90,
        page_width_px=100,
        page_height_px=200,
        page_width_pt=50,
        page_height_pt=100,
        segments=[(left, left + 30, text)],
    )


class OcrCollectionTests(unittest.TestCase):
    def test_collects_best_language_per_pass_filters_noise_and_sorts(self) -> None:
        reports: dict[str, object] = {"warnings": []}

        def run(_image: str, language: str, *, psm: str) -> str:
            if language == "broken":
                raise RuntimeError(f"{psm} failed")
            return f"{psm}:{language}"

        def parse(tsv: str, *_dimensions: float) -> list[LineBox]:
            psm, language = tsv.split(":")
            top = 40 if psm == "3" else 10
            return [line(f"{language}-{psm}", top=top), line("noise", top=top + 1)]

        def score(lines: list[LineBox], language: str) -> float:
            del lines
            return {"eng": 20.0, "rus": 10.0}[language]

        with (
            patch.object(
                collection,
                "ocr_language_candidates",
                return_value=["eng", "rus", "broken"],
            ),
            patch.object(collection, "run_tesseract_tsv", side_effect=run),
            patch.object(collection, "parse_tsv", side_effect=parse),
            patch.object(collection, "score_ocr_lines", side_effect=score),
            patch.object(
                collection,
                "line_text_signal",
                side_effect=lambda value: value.text != "noise",
            ),
            patch.object(
                collection,
                "merge_line_candidates",
                side_effect=lambda current, incoming, _lang: current + incoming,
            ),
        ):
            result = collection.collect_ocr_lines(
                "page.png", "auto", 100, 200, 50, 100, ["3", "6"], reports
            )

        self.assertEqual([item.text for item in result], ["eng-6", "eng-3"])
        self.assertEqual(len(reports["ocrPasses"]), 2)
        self.assertIn("rus:2@10.0", reports["ocrPasses"][0])

    def test_hosted_failures_mark_timeout_once_and_continue(self) -> None:
        report: dict[str, object] = {"warnings": []}
        with (
            patch.object(collection, "FAST_HOSTED_OCR", True),
            patch.object(collection, "ocr_language_candidates", return_value=["eng"]),
            patch.object(
                collection, "run_tesseract_tsv", side_effect=TimeoutError("slow")
            ),
        ):
            result = collection.collect_ocr_lines(
                "page.png", "eng", 100, 100, 50, 50, ["3", "6"], report
            )

        self.assertEqual(result, [])
        self.assertTrue(report["hostedOcrTimedOut"])
        self.assertEqual(len(report["warnings"]), 1)
        self.assertEqual(len(report["ocrPasses"]), 2)

    def test_local_failures_raise_engine_details_or_default_message(self) -> None:
        with (
            patch.object(collection, "FAST_HOSTED_OCR", False),
            patch.object(collection, "ocr_language_candidates", return_value=["eng"]),
            patch.object(
                collection, "run_tesseract_tsv", side_effect=OSError("not installed")
            ),
            self.assertRaisesRegex(RuntimeError, "eng: not installed"),
        ):
            collection.collect_ocr_lines("page.png", "eng", 100, 100, 50, 50, ["6"], {})

        with (
            patch.object(collection, "FAST_HOSTED_OCR", False),
            patch.object(collection, "ocr_language_candidates", return_value=[]),
            self.assertRaisesRegex(RuntimeError, "Tesseract OCR failed"),
        ):
            collection.collect_ocr_lines("page.png", "eng", 100, 100, 50, 50, ["6"], {})

    def test_offsets_lines_words_and_segments_without_mutating_source(self) -> None:
        original = line("Shift me", left=3, top=4)
        shifted = collection.offset_ocr_lines([original], 7, 11, 400, 600, 200, 300)[0]

        self.assertEqual((shifted.left, shifted.top), (10, 15))
        self.assertEqual((shifted.words[0].left, shifted.words[0].top), (10, 15))
        self.assertEqual(shifted.segments, [(10, 40, "Shift me")])
        self.assertEqual((shifted.page_width_px, shifted.page_height_pt), (400, 300))
        self.assertEqual((original.left, original.top), (3, 4))

    def test_region_collection_clamps_crop_offsets_and_restores_hosted_timeout(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image_path = Path(tmp, "page.png")
            Image.new("RGB", (40, 30), "white").save(image_path)
            relative = line("Region", left=1, top=2)

            with (
                patch.object(collection, "FAST_HOSTED_OCR", True),
                patch.object(
                    collection, "collect_ocr_lines", return_value=[relative]
                ) as collect,
                patch.dict(collection.os.environ, {}, clear=True),
            ):
                shifted = collection.collect_ocr_lines_region(
                    str(image_path),
                    "eng",
                    (-20, -10, 99, 99),
                    40,
                    30,
                    20,
                    15,
                    ["6"],
                    {},
                    "full",
                )
                self.assertNotIn("FILEMINT_TESSERACT_TIMEOUT_SEC", os.environ)

            self.assertEqual((shifted[0].left, shifted[0].top), (1, 2))
            called = collect.call_args.args
            self.assertEqual(called[2:6], (40, 30, 20.0, 15.0))

    def test_region_collection_restores_existing_timeout_and_survives_cleanup_error(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image_path = Path(tmp, "page.png")
            Image.new("RGB", (40, 30), "white").save(image_path)
            with (
                patch.object(collection, "FAST_HOSTED_OCR", True),
                patch.object(collection, "collect_ocr_lines", return_value=[]),
                patch.object(collection.os, "remove", side_effect=OSError("locked")),
                patch.dict(
                    collection.os.environ,
                    {"FILEMINT_TESSERACT_TIMEOUT_SEC": "9"},
                    clear=True,
                ),
            ):
                self.assertEqual(
                    collection.collect_ocr_lines_region(
                        str(image_path),
                        "eng",
                        (5, 5, 5, 5),
                        40,
                        30,
                        20,
                        15,
                        ["6"],
                        {},
                        "small",
                    ),
                    [],
                )
                self.assertEqual(os.environ["FILEMINT_TESSERACT_TIMEOUT_SEC"], "9")

    def test_non_hosted_region_uses_plain_crop_without_timeout_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image_path = Path(tmp, "page.png")
            Image.new("RGB", (20, 20), "white").save(image_path)
            with (
                patch.object(collection, "FAST_HOSTED_OCR", False),
                patch.object(collection, "collect_ocr_lines", return_value=[]),
            ):
                result = collection.collect_ocr_lines_region(
                    str(image_path),
                    "eng",
                    (2, 3, 10, 12),
                    20,
                    20,
                    10,
                    10,
                    ["6"],
                    {},
                    "plain",
                )
        self.assertEqual(result, [])

    def test_hosted_transcript_collection_guards_invalid_geometry(self) -> None:
        args = ("page.png", "eng", 100.0, 200.0, 50.0, 100.0)
        with patch.object(collection, "FAST_HOSTED_OCR", False):
            self.assertEqual(
                collection.collect_hosted_transcript_ocr_lines(
                    *args, {"xPositionsPx": range(6), "yPositionsPx": range(8)}, {}
                ),
                [],
            )
        with patch.object(collection, "FAST_HOSTED_OCR", True):
            self.assertEqual(
                collection.collect_hosted_transcript_ocr_lines(*args, None, {}), []
            )
            self.assertEqual(
                collection.collect_hosted_transcript_ocr_lines(
                    *args, {"xPositionsPx": [1, 2], "yPositionsPx": range(8)}, {}
                ),
                [],
            )

    def test_hosted_transcript_collects_header_and_five_columns(self) -> None:
        geometry = {
            "xPositionsPx": [10, 25, 40, 55, 70, 90],
            "yPositionsPx": [60, 70, 80, 90, 100, 110, 120, 130],
        }
        report: dict[str, object] = {"notes": []}
        returned = [line("Header", top=5)]
        with (
            patch.object(collection, "FAST_HOSTED_OCR", True),
            patch.object(
                collection, "collect_ocr_lines_region", return_value=returned
            ) as collect_region,
            patch.object(
                collection,
                "merge_line_candidates",
                side_effect=lambda current, incoming, _lang: current + incoming,
            ),
        ):
            result = collection.collect_hosted_transcript_ocr_lines(
                "page.png", "eng", 100, 200, 50, 100, geometry, report
            )

        self.assertEqual(collect_region.call_count, 6)
        self.assertEqual(len(result), 6)
        self.assertIn("region-based table pass", report["notes"][0])

    def test_hosted_transcript_does_not_claim_an_empty_pass(self) -> None:
        geometry = {
            "xPositionsPx": [10, 25, 40, 55, 70, 90],
            "yPositionsPx": [60, 70, 80, 90, 100, 110, 120, 130],
        }
        report: dict[str, object] = {"notes": []}
        with (
            patch.object(collection, "FAST_HOSTED_OCR", True),
            patch.object(collection, "collect_ocr_lines_region", return_value=[]),
        ):
            result = collection.collect_hosted_transcript_ocr_lines(
                "page.png", "eng", 100, 200, 50, 100, geometry, report
            )
        self.assertEqual(result, [])
        self.assertEqual(report["notes"], [])


if __name__ == "__main__":
    unittest.main()
