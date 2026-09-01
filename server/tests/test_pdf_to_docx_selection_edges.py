"""Edge-case coverage for OCR candidate filtering and de-duplication."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from server.pdf_to_docx_core import selection
from server.pdf_to_docx_core.models import LineBox, WordBox


def line(
    text: str,
    *,
    left: float = 20,
    top: float = 30,
    width: float = 120,
    height: float = 20,
    conf: float = 90,
    words: list[WordBox] | None = None,
) -> LineBox:
    word_boxes = words or [WordBox(text, left, top, width, height, conf, 1, 1, 1)]
    return LineBox(
        text,
        word_boxes,
        left,
        top,
        width,
        height,
        conf,
        1000,
        1400,
        500,
        700,
        [(left, left + width, text)],
    )


class OcrSelectionEdgeTests(unittest.TestCase):
    def test_colored_mark_detection_rejects_empty_and_ignores_white_pixels(
        self,
    ) -> None:
        image = Image.new("RGB", (100, 80), "white")
        self.assertFalse(
            selection.line_overlaps_colored_mark(
                image, line("outside", left=150, top=100, width=0, height=0)
            )
        )
        self.assertFalse(selection.line_overlaps_colored_mark(image, line("clean")))

    def test_line_filter_distinguishes_colored_marks_by_premium_confidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "marked.png")
            image = Image.new("RGB", (300, 180), "white")
            ImageDraw.Draw(image).rectangle((10, 10, 180, 80), fill=(210, 20, 30))
            image.save(source)
            marked = line("Official stamp", left=20, top=25, conf=58)

            normal, normal_stats = selection.exact_editable_lines(
                str(source), [marked], "eng", premium=False
            )
            premium_low, premium_low_stats = selection.exact_editable_lines(
                str(source), [marked], "eng", premium=True
            )
            marked.conf = 95
            marked.words[0].conf = 95
            premium_high, premium_high_stats = selection.exact_editable_lines(
                str(source), [marked], "eng", premium=True
            )

        self.assertEqual(normal, [])
        self.assertEqual(normal_stats["skippedColoredMarks"], 1)
        self.assertEqual(premium_low, [])
        self.assertEqual(premium_low_stats["skippedColoredMarks"], 1)
        self.assertEqual([item.text for item in premium_high], ["Official stamp"])
        self.assertEqual(premium_high_stats["editableCharacters"], 14)

    def test_word_filter_counts_noise_confidence_color_and_duplicates(self) -> None:
        words = [
            WordBox("Approved", 20, 20, 80, 18, 95, 1, 1, 1),
            WordBox("Approved", 22, 21, 80, 18, 94, 1, 1, 2),
            WordBox("uncertain", 20, 55, 90, 18, 50, 1, 2, 1),
            WordBox("xx", 20, 85, 8, 10, 15, 1, 3, 1),
        ]
        parent = line("Approved Approved uncertain xx", words=words)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "page.png")
            Image.new("RGB", (300, 180), "white").save(source)
            editable, stats = selection.exact_editable_word_lines(
                str(source), [parent], "eng"
            )

        self.assertEqual([item.text for item in editable], ["Approved"])
        self.assertEqual(stats["ocrTextCandidates"], 3)
        self.assertEqual(stats["skippedLowConfidence"], 1)
        self.assertEqual(stats["skippedNoise"], 1)

    def test_duplicate_word_requires_matching_text_and_overlapping_area(self) -> None:
        existing = [line("same", left=10, top=10, width=100, height=20)]
        self.assertFalse(
            selection.is_duplicate_word_line(
                line("same", left=20, top=100, width=100, height=20), existing
            )
        )
        self.assertFalse(
            selection.is_duplicate_word_line(
                line("same", left=105, top=10, width=100, height=20), existing
            )
        )

    def test_dense_scan_secondary_heuristic_uses_row_proximity(self) -> None:
        close_rows = [line(f"row {index}", top=index * 20) for index in range(80)]
        sparse_valid_rows = [
            line(f"row {index}", top=index * 60, height=20 if index < 39 else 0)
            for index in range(80)
        ]
        self.assertTrue(selection.dense_table_scan_likely(close_rows))
        self.assertFalse(selection.dense_table_scan_likely(sparse_valid_rows))

    def test_transcript_geometry_requires_dimensions_and_textual_evidence(self) -> None:
        geometry = {
            "xPositionsPx": list(range(6)),
            "yPositionsPx": list(range(8)),
        }
        self.assertFalse(selection.transcript_scan_likely([]))
        self.assertFalse(
            selection.transcript_rebuild_likely(
                [line("student academic course grade")],
                {"xPositionsPx": [1], "yPositionsPx": list(range(8))},
            )
        )
        self.assertFalse(selection.transcript_rebuild_likely([], geometry))
        self.assertTrue(
            selection.transcript_rebuild_likely(
                [line("student academic course grade")], geometry
            )
        )
        grade_rows = [line(f"subject {index} 5/5 4/5") for index in range(16)]
        self.assertTrue(selection.transcript_rebuild_likely(grade_rows, geometry))

    def test_bold_and_noise_heuristics_cover_headers_and_multilingual_artifacts(
        self,
    ) -> None:
        self.assertFalse(selection.line_should_be_bold(line("123", top=400)))
        self.assertTrue(selection.line_should_be_bold(line("Heading", top=10)))
        self.assertTrue(selection.line_should_be_bold(line("UPPERCASE", top=400)))
        self.assertFalse(selection.line_should_be_bold(line("Ordinary text", top=400)))
        self.assertTrue(selection.probable_ocr_noise(line("", width=5), "eng"))
        self.assertTrue(
            selection.probable_ocr_noise(line("AA BB CC", conf=45), "chi_sim")
        )

    def test_duplicate_indices_accept_aligned_centers_without_large_area_overlap(
        self,
    ) -> None:
        existing = line("wide", left=0, top=10, width=200, height=20)
        narrow = line("narrow", left=90, top=10, width=20, height=20)
        separate = line("separate", left=90, top=100, width=20, height=20)
        self.assertEqual(selection.duplicate_line_indices(narrow, [existing]), [0])
        self.assertFalse(selection.is_duplicate_line(separate, [existing]))

    def test_merge_keeps_stronger_candidate_and_adds_distinct_content(self) -> None:
        strong = line("Strong existing content", conf=98)
        weaker = line("weak", conf=50)
        distinct = line("separate", left=400, top=200, conf=85)
        result = selection.merge_line_candidates([strong], [weaker, distinct], "eng")
        self.assertEqual(
            [item.text for item in result], ["Strong existing content", "separate"]
        )
        self.assertGreater(
            selection.line_quality_score(strong, "eng"),
            selection.line_quality_score(line("x", conf=10, width=5), "eng"),
        )


if __name__ == "__main__":
    unittest.main()
