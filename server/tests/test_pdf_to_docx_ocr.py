from __future__ import annotations

import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from server.pdf_to_docx_core import ocr
from server.pdf_to_docx_core.models import LineBox, WordBox


TSV_HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"


def tsv_word(
    text: str, *, line: int, left: int, top: int = 10, conf: float = 90
) -> str:
    return f"5\t1\t1\t1\t{line}\t1\t{left}\t{top}\t30\t12\t{conf}\t{text}"


def make_word(
    text: str, *, left: float = 0, top: float = 0, conf: float = 90
) -> WordBox:
    return WordBox(text, left, top, 20, 10, conf, 1, 1, 1)


def make_line(
    text: str, *, left: float = 0, top: float = 0, conf: float = 90
) -> LineBox:
    word = make_word(text, left=left, top=top, conf=conf)
    return LineBox(
        text,
        [word],
        left,
        top,
        20,
        10,
        conf,
        1000,
        1400,
        500,
        700,
        [(left, left + 20, text)],
    )


class OcrParsingTests(unittest.TestCase):
    def test_normalize_ocr_text_collapses_spaces_and_punctuation(self) -> None:
        self.assertEqual(
            ocr.normalize_ocr_text("  File   Mint  ,  Inc.  "), "File Mint, Inc."
        )

    def test_normalize_ocr_text_joins_cjk_glyphs(self) -> None:
        self.assertEqual(ocr.normalize_ocr_text("文 件 转 换"), "文件转换")

    def test_parse_tsv_groups_words_by_visual_line(self) -> None:
        tsv = "\n".join(
            [
                TSV_HEADER,
                tsv_word("File", line=1, left=10),
                tsv_word("Mint", line=1, left=50, conf=80),
                tsv_word("Second", line=2, left=10, top=40),
            ]
        )
        lines = ocr.parse_tsv(tsv, 1000, 1400, 500, 700)
        self.assertEqual([line.text for line in lines], ["File Mint", "Second"])
        self.assertEqual(lines[0].conf, 85)
        self.assertEqual(len(lines[0].words), 2)

    def test_parse_tsv_ignores_non_word_and_malformed_rows(self) -> None:
        tsv = "\n".join(
            [
                TSV_HEADER,
                "4\t1\t1\t1\t1\t0\t0\t0\t0\t0\t-1\tignored",
                tsv_word("valid", line=1, left=10),
                "5\t1\tbad\t1\t1\t2\t20\t10\t10\t10\t90\tbroken",
                tsv_word("", line=2, left=10),
            ]
        )
        self.assertEqual(
            [line.text for line in ocr.parse_tsv(tsv, 100, 100, 100, 100)], ["valid"]
        )

    def test_segment_line_splits_large_horizontal_gaps(self) -> None:
        words = [
            make_word("left", left=0),
            make_word("side", left=24),
            make_word("right", left=180),
        ]
        self.assertEqual(
            ocr.segment_line(words), [(0, 44, "left side"), (180, 200, "right")]
        )

    def test_rebuild_rows_groups_words_using_vertical_centers(self) -> None:
        words = [
            make_word("A", left=0, top=10),
            make_word("B", left=30, top=11),
            make_word("C", left=0, top=60),
        ]
        lines = ocr.rebuild_rows_from_word_geometry(words, 100, 100, 100, 100)
        self.assertEqual([line.text for line in lines], ["A B", "C"])

    def test_unique_lang_preserves_order_and_removes_duplicates(self) -> None:
        self.assertEqual(ocr.unique_lang(["eng", "rus", "eng", ""]), "eng+rus")

    def test_language_candidates_add_script_specific_fallbacks(self) -> None:
        with patch.object(ocr, "FAST_HOSTED_OCR", False):
            candidates = ocr.ocr_language_candidates("eng+chi_sim+rus")
        self.assertEqual(candidates[0], "eng+chi_sim+rus")
        self.assertIn("eng+chi_sim", candidates)
        self.assertIn("chi_sim", candidates)
        self.assertEqual(len(candidates), len(set(candidates)))

    def test_hosted_language_candidates_use_one_installed_language(self) -> None:
        with patch.object(ocr, "FAST_HOSTED_OCR", True):
            self.assertEqual(ocr.ocr_language_candidates("rus+eng"), ["eng"])

    def test_script_counts_classifies_supported_writing_systems(self) -> None:
        counts = ocr.script_counts("ABC АБВ 中文 فارسی 123")
        self.assertEqual(counts["latin"], 3)
        self.assertEqual(counts["cyrillic"], 3)
        self.assertEqual(counts["cjk"], 2)
        self.assertGreaterEqual(counts["rtl"], 5)
        self.assertEqual(counts["digits"], 3)

    def test_score_ocr_lines_rewards_confidence_and_script_match(self) -> None:
        high = [make_line("中文文件转换测试中文", conf=92)]
        low = [make_line("???", conf=10)]
        self.assertGreater(
            ocr.score_ocr_lines(high, "chi_sim"), ocr.score_ocr_lines(low, "eng")
        )
        self.assertEqual(ocr.score_ocr_lines([], "eng"), -1000)

    def test_run_tesseract_returns_stdout(self) -> None:
        completed = SimpleNamespace(returncode=0, stdout="tsv-output", stderr="")
        with (
            patch.object(ocr, "find_tesseract", return_value="tesseract"),
            patch.object(ocr, "tessdata_dir_for_lang", return_value=None),
            patch.object(ocr.subprocess, "run", return_value=completed) as run,
        ):
            self.assertEqual(
                ocr.run_tesseract_tsv("page.png", "eng", "6"), "tsv-output"
            )
        self.assertEqual(run.call_args.args[0][-1], "tsv")
        self.assertIn("6", run.call_args.args[0])

    def test_run_tesseract_surfaces_timeout_as_actionable_error(self) -> None:
        with (
            patch.object(ocr, "find_tesseract", return_value="tesseract"),
            patch.object(ocr, "tessdata_dir_for_lang", return_value=None),
            patch.object(
                ocr.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("tesseract", 1),
            ),
            patch.dict(ocr.os.environ, {"FILEMINT_TESSERACT_TIMEOUT_SEC": "1"}),
        ):
            with self.assertRaisesRegex(RuntimeError, "timed out after 1s"):
                ocr.run_tesseract_tsv("page.png", "eng")

    def test_run_tesseract_surfaces_engine_errors(self) -> None:
        completed = SimpleNamespace(
            returncode=1, stdout="", stderr="language data missing"
        )
        with (
            patch.object(ocr, "find_tesseract", return_value="tesseract"),
            patch.object(ocr, "tessdata_dir_for_lang", return_value=None),
            patch.object(ocr.subprocess, "run", return_value=completed),
        ):
            with self.assertRaisesRegex(RuntimeError, "language data missing"):
                ocr.run_tesseract_tsv("page.png", "eng")


if __name__ == "__main__":
    unittest.main()
