from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from server.pdf_to_docx_core.native import (
    PdfLine,
    PdfSpan,
    append_pdf_line,
    collect_pdf_lines,
    estimated_gap_spaces,
    merge_visual_rows,
    span_is_bold,
    span_is_italic,
    span_text,
    to_docx_digital_text_flow,
    vertical_overlap,
    word_font_name,
    xml_compatible_text,
)
from server.pdf_to_docx_core.reporting import docx_output_stats


def make_span(
    text: str,
    *,
    left: float = 0,
    top: float = 0,
    right: float = 20,
    bottom: float = 12,
    font: str = "Times-Roman",
    size: float = 11,
    flags: int = 0,
) -> PdfSpan:
    return PdfSpan(text, font, size, flags, 0, (left, top, right, bottom))


def make_line(
    text: str, *, left: float = 0, top: float = 0, right: float = 40, bottom: float = 12
) -> PdfLine:
    return PdfLine(
        [make_span(text, left=left, top=top, right=right, bottom=bottom)],
        left,
        top,
        right,
        bottom,
    )


class FakePage:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def get_text(self, mode: str, sort: bool = False) -> dict[str, object]:
        self.mode = mode
        self.sort = sort
        return self.payload


class NativePdfModelTests(unittest.TestCase):
    def test_span_text_preserves_visual_order(self) -> None:
        self.assertEqual(span_text([make_span("File"), make_span("Mint")]), "FileMint")

    def test_collect_pdf_lines_filters_non_text_and_empty_spans(self) -> None:
        page = FakePage(
            {
                "blocks": [
                    {
                        "type": 1,
                        "lines": [{"bbox": [0, 0, 1, 1], "spans": [{"text": "image"}]}],
                    },
                    {
                        "type": 0,
                        "lines": [
                            {
                                "bbox": [20, 30, 80, 42],
                                "spans": [{"text": "second", "bbox": [20, 30, 80, 42]}],
                            },
                            {
                                "bbox": [10, 10, 70, 22],
                                "spans": [{"text": "first", "bbox": [10, 10, 70, 22]}],
                            },
                            {"bbox": [0, 0, 0, 0], "spans": [{"text": ""}]},
                        ],
                    },
                ]
            }
        )
        lines = collect_pdf_lines(page)
        self.assertEqual([span_text(line.spans) for line in lines], ["first", "second"])
        self.assertEqual(lines[0].spans[0].size, 11.0)

    def test_vertical_overlap_is_normalized_to_shorter_line(self) -> None:
        a = make_line("a", top=10, bottom=30)
        b = make_line("b", top=20, bottom=40)
        c = make_line("c", top=50, bottom=60)
        self.assertEqual(vertical_overlap(a, b), 0.5)
        self.assertEqual(vertical_overlap(a, c), 0.0)

    def test_merge_visual_rows_combines_columns_but_not_separate_rows(self) -> None:
        lines = [
            make_line("right", left=100, right=150, top=10, bottom=22),
            make_line("left", left=10, right=50, top=11, bottom=23),
            make_line("next", left=10, right=60, top=60, bottom=72),
        ]
        merged = merge_visual_rows(lines)
        self.assertEqual(len(merged), 2)
        self.assertEqual(span_text(merged[0].spans), "leftright")
        self.assertEqual(span_text(merged[1].spans), "next")

    def test_font_mapping_handles_monospace_and_regular_fonts(self) -> None:
        self.assertEqual(word_font_name("CourierNewPSMT"), "Courier New")
        self.assertEqual(word_font_name("CM-TT10"), "Courier New")
        self.assertEqual(word_font_name("Helvetica"), "Times New Roman")

    def test_bold_and_italic_detection_uses_flags_and_font_names(self) -> None:
        self.assertTrue(span_is_bold(make_span("x", flags=16)))
        self.assertTrue(span_is_bold(make_span("x", font="Arial-Bold")))
        self.assertTrue(span_is_italic(make_span("x", flags=2)))
        self.assertTrue(span_is_italic(make_span("x", font="Times-Italic")))
        self.assertFalse(span_is_bold(make_span("x")))
        self.assertFalse(span_is_italic(make_span("x")))

    def test_xml_compatible_text_removes_control_characters(self) -> None:
        self.assertEqual(xml_compatible_text("A\x00B\x08C\nD\tE"), "ABC\nD\tE")

    def test_gap_estimation_is_bounded(self) -> None:
        self.assertEqual(estimated_gap_spaces(0.5, 12), 0)
        self.assertEqual(estimated_gap_spaces(8, 12), 2)
        self.assertEqual(estimated_gap_spaces(10_000, 12), 24)

    def test_append_pdf_line_infers_spacing_and_returns_character_count(self) -> None:
        from docx import Document

        line = PdfLine(
            [make_span("File", left=0, right=20), make_span("Mint", left=35, right=60)],
            0,
            0,
            60,
            12,
        )
        document = Document()
        emitted = append_pdf_line(document, line, None, 0)
        self.assertEqual(document.paragraphs[-1].text, "File    Mint")
        self.assertEqual(emitted, len("File    Mint"))

    def test_native_text_flow_creates_editable_docx(self) -> None:
        import fitz

        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "target.docx"
            pdf = fitz.open()
            page = pdf.new_page(width=300, height=200)
            page.insert_text((30, 60), "FileMint native conversion text")
            pdf.save(source)
            pdf.close()

            report: dict[str, object] = {"notes": []}
            to_docx_digital_text_flow(str(source), str(target), report)
            stats = docx_output_stats(str(target))

            self.assertTrue(target.exists())
            self.assertEqual(report["resolvedMode"], "premium-digital-flow")
            self.assertGreater(stats["outputEditableCharacters"], 20)
            self.assertGreater(stats["outputTextRuns"], 0)


if __name__ == "__main__":
    unittest.main()
