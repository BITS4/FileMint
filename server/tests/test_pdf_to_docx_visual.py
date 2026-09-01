from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from server.pdf_to_docx_core.models import LineBox, VisualRule, WordBox
from server.pdf_to_docx_core.visual import (
    color_hex_from_region,
    make_residual_image,
    merge_visual_rules,
    remove_text_regions_rgb,
    save_transparent_fragment,
    segment_visual_layer,
)


def make_line() -> LineBox:
    word = WordBox("text", 30, 30, 50, 15, 95, 1, 1, 1)
    return LineBox(
        "text", [word], 30, 30, 50, 15, 95, 200, 120, 400, 240, [(30, 80, "text")]
    )


class VisualSegmentationTests(unittest.TestCase):
    def test_make_residual_image_whitens_only_editable_text_regions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.png"
            target = Path(tmp) / "residual.png"
            Image.new("RGB", (200, 120), "black").save(source)
            make_residual_image(str(source), str(target), [make_line()])
            residual = Image.open(target).convert("RGB")
            self.assertEqual(residual.getpixel((40, 35)), (255, 255, 255))
            self.assertEqual(residual.getpixel((180, 100)), (0, 0, 0))

    def test_remove_text_regions_rgb_mutates_the_expected_slice(self) -> None:
        image = np.zeros((120, 200, 3), dtype=np.uint8)
        remove_text_regions_rgb(image, [make_line()])
        self.assertTrue(np.all(image[35, 40] == 255))
        self.assertTrue(np.all(image[100, 180] == 0))

    def test_color_extraction_uses_nonwhite_median_and_safe_fallback(self) -> None:
        image = np.full((20, 20, 3), 255, dtype=np.uint8)
        self.assertEqual(color_hex_from_region(image, 0, 0, 20, 20), "#AEB6BC")
        image[5:15, 5:15] = [20, 80, 200]
        self.assertEqual(color_hex_from_region(image, 0, 0, 20, 20), "#1450C8")
        self.assertEqual(color_hex_from_region(image, 30, 30, 40, 40), "#AEB6BC")

    def test_transparent_fragment_requires_a_meaningful_mask(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "fragment.png"
            rgb = np.zeros((10, 10, 3), dtype=np.uint8)
            tiny = np.zeros((10, 10), dtype=np.uint8)
            tiny[0, 0] = 255
            self.assertFalse(save_transparent_fragment(rgb, tiny, str(output)))
            full = np.full((10, 10), 255, dtype=np.uint8)
            self.assertTrue(save_transparent_fragment(rgb, full, str(output)))
            with Image.open(output) as fragment:
                self.assertEqual(fragment.mode, "RGBA")

    def test_visual_rules_merge_only_when_color_row_and_gap_match(self) -> None:
        rules = [
            VisualRule(10, 20, 30, 2, "#000000"),
            VisualRule(42, 20, 20, 2, "#000000"),
            VisualRule(70, 20, 10, 2, "#FF0000"),
            VisualRule(10, 80, 10, 2, "#000000"),
        ]
        merged = merge_visual_rules(rules)
        self.assertEqual(len(merged), 3)
        self.assertEqual((merged[0].left, merged[0].width), (10, 52))

    def test_segment_visual_layer_extracts_colored_marks_and_horizontal_rules(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "page.png"
            image = Image.new("RGB", (500, 320), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((40, 40, 120, 120), fill=(200, 20, 20))
            draw.rectangle((180, 220, 430, 223), fill=(20, 20, 20))
            image.save(source)

            fragments, rules = segment_visual_layer(str(source), tmp, 0, [], 500, 320)

            self.assertTrue(
                any(fragment.kind == "colored-mark" for fragment in fragments)
            )
            self.assertTrue(all(Path(fragment.path).exists() for fragment in fragments))
            self.assertGreaterEqual(len(rules), 1)


if __name__ == "__main__":
    unittest.main()
