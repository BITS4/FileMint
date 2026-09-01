from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.pdf_to_docx_core import collection, selection
from server.pdf_to_docx_core.models import LineBox, WordBox


def make_line(
    text: str,
    *,
    left: float = 10,
    top: float = 10,
    width: float = 120,
    height: float = 20,
    conf: float = 90,
    words: int = 1,
    segments: int = 1,
) -> LineBox:
    word_width = width / max(1, words)
    word_boxes = [
        WordBox(
            f"{text}{i}" if words > 1 else text,
            left + i * word_width,
            top,
            word_width,
            height,
            conf,
            1,
            1,
            1,
        )
        for i in range(words)
    ]
    segment_width = width / max(1, segments)
    segment_boxes = [
        (left + i * segment_width, left + (i + 1) * segment_width, f"segment-{i}")
        for i in range(segments)
    ]
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
        segment_boxes,
    )


class OcrSelectionTests(unittest.TestCase):
    def test_confidence_thresholds_are_more_permissive_for_multilingual_ocr(
        self,
    ) -> None:
        self.assertEqual(selection.editable_confidence_threshold("eng"), 72)
        self.assertEqual(selection.editable_confidence_threshold("eng+rus"), 42)
        self.assertEqual(selection.premium_confidence_threshold("eng"), 38)
        self.assertEqual(selection.premium_confidence_threshold("fas"), 18)

    def test_line_signal_requires_meaningful_alphanumeric_text(self) -> None:
        self.assertTrue(selection.line_text_signal(make_line("A1")))
        self.assertFalse(selection.line_text_signal(make_line("--")))
        self.assertFalse(selection.line_is_confident(make_line("A", conf=95), 72))
        self.assertFalse(selection.line_is_confident(make_line("Text", conf=30), 72))

    def test_word_as_line_preserves_parent_page_geometry(self) -> None:
        parent = make_line("parent")
        word = WordBox("child", 30, 40, 50, 12, 88, 2, 3, 4)
        child = selection.word_as_line(word, parent)
        self.assertEqual(child.text, "child")
        self.assertEqual(child.page_width_pt, parent.page_width_pt)
        self.assertEqual(child.segments, [(30, 80, "child")])

    def test_duplicate_detection_uses_text_and_geometry(self) -> None:
        existing = [make_line("same", left=10, top=10)]
        self.assertTrue(
            selection.is_duplicate_word_line(
                make_line("SAME", left=12, top=11), existing
            )
        )
        self.assertFalse(
            selection.is_duplicate_word_line(
                make_line("other", left=12, top=11), existing
            )
        )
        self.assertFalse(
            selection.is_duplicate_word_line(
                make_line("same", left=400, top=400), existing
            )
        )

    def test_overlap_ratio_and_duplicate_indices(self) -> None:
        base = make_line("base", left=10, top=10, width=100, height=20)
        overlap = make_line("replacement", left=20, top=10, width=100, height=20)
        distant = make_line("distant", left=300, top=300)
        self.assertGreater(selection.line_overlap_ratio(base, overlap), 0.8)
        self.assertEqual(selection.line_overlap_ratio(base, distant), 0)
        self.assertEqual(
            selection.duplicate_line_indices(overlap, [base, distant]), [0]
        )

    def test_noise_filter_rejects_short_low_confidence_artifacts(self) -> None:
        self.assertTrue(
            selection.probable_ocr_noise(make_line("x", conf=20, width=10), "eng")
        )
        self.assertFalse(
            selection.probable_ocr_noise(make_line("FileMint", conf=90), "eng")
        )

    def test_merge_candidates_replaces_weaker_overlapping_result(self) -> None:
        weak = make_line("F1leM1nt", conf=38)
        strong = make_line("FileMint document converter", conf=96)
        merged = selection.merge_line_candidates([weak], [strong], "eng")
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, strong.text)

    def test_dense_table_heuristic_requires_breadth_and_structure(self) -> None:
        table = [
            make_line(f"row {i} 5/5", top=i * 25, words=4, segments=3)
            for i in range(24)
        ]
        self.assertTrue(selection.dense_table_scan_likely(table))
        self.assertFalse(selection.dense_table_scan_likely(table[:5]))

    def test_transcript_heuristic_requires_multiple_independent_signals(self) -> None:
        transcript = make_line(
            "Student personal information academic record course title average grade "
            "grade 9 grade 10 school language graduation 5/5 4/5 8/10 9/10"
        )
        self.assertTrue(selection.transcript_scan_likely([transcript]))
        self.assertFalse(
            selection.transcript_scan_likely([make_line("invoice total 5/5")])
        )

    def test_transcript_rebuild_can_use_detected_grid_evidence(self) -> None:
        lines = [
            make_line("student academic course grade 5/5 4/5"),
            make_line("average 8/10 9/10", top=40),
        ]
        geometry = {"xPositionsPx": [1, 2, 3, 4, 5, 6], "yPositionsPx": list(range(8))}
        self.assertTrue(selection.transcript_rebuild_likely(lines * 8, geometry))
        self.assertFalse(selection.transcript_rebuild_likely(lines, None))

    def test_colored_mark_detection_distinguishes_red_annotations(self) -> None:
        image = Image.new("RGB", (200, 100), "white")
        for x in range(5, 150):
            for y in range(5, 50):
                image.putpixel((x, y), (220, 20, 20))
        self.assertTrue(
            selection.line_overlaps_colored_mark(
                image, make_line("Marked", left=10, top=10)
            )
        )
        self.assertFalse(
            selection.line_overlaps_colored_mark(
                image, make_line("Clean", left=160, top=70, width=20)
            )
        )

    def test_exact_editable_lines_reports_acceptance_and_rejection_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image_path = Path(tmp) / "page.png"
            Image.new("RGB", (300, 200), "white").save(image_path)
            accepted = make_line("Editable text", conf=95)
            low = make_line("Low confidence", top=50, conf=40)
            noise = make_line("xx", top=90, width=10, conf=20)
            editable, stats = selection.exact_editable_lines(
                str(image_path), [accepted, low, noise], "eng"
            )
        self.assertEqual([line.text for line in editable], ["Editable text"])
        self.assertEqual(stats["editableTextBoxes"], 1)
        self.assertEqual(stats["skippedLowConfidence"], 1)
        self.assertEqual(stats["skippedNoise"], 1)

    def test_offset_lines_updates_every_coordinate_without_mutating_source(
        self,
    ) -> None:
        original = make_line("shift", left=5, top=7)
        shifted = collection.offset_ocr_lines(
            [original], 100, 200, 2000, 2800, 1000, 1400
        )[0]
        self.assertEqual((shifted.left, shifted.top), (105, 207))
        self.assertEqual((shifted.words[0].left, shifted.words[0].top), (105, 207))
        self.assertEqual(shifted.segments[0][:2], (105, 225))
        self.assertEqual((original.left, original.top), (5, 7))

    def test_collect_ocr_lines_chooses_highest_scoring_language_pass(self) -> None:
        english = [make_line("English", conf=55)]
        russian = [make_line("Русский документ", conf=95)]
        report: dict[str, object] = {"warnings": []}
        with (
            patch.object(
                collection, "ocr_language_candidates", return_value=["eng", "rus"]
            ),
            patch.object(
                collection,
                "run_tesseract_tsv",
                side_effect=lambda _image, lang, psm: lang,
            ),
            patch.object(
                collection,
                "parse_tsv",
                side_effect=lambda tsv, *_args: english if tsv == "eng" else russian,
            ),
            patch.object(
                collection,
                "score_ocr_lines",
                side_effect=lambda lines, _lang: lines[0].conf,
            ),
        ):
            result = collection.collect_ocr_lines(
                "page.png", "eng+rus", 100, 100, 100, 100, ["6"], report
            )
        self.assertEqual([line.text for line in result], ["Русский документ"])
        self.assertIn("psm-6/rus", str(report["ocrPasses"][0]))


if __name__ == "__main__":
    unittest.main()
