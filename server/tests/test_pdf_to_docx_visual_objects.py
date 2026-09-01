"""Visual segmentation coverage for non-text artwork and safe empty inputs."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from server.pdf_to_docx_core.models import LineBox, WordBox
from server.pdf_to_docx_core.visual import (
    remove_text_regions_rgb,
    save_transparent_fragment,
    segment_visual_layer,
)


def outside_line() -> LineBox:
    word = WordBox("outside", 200, 200, 30, 10, 90, 1, 1, 1)
    return LineBox(
        "outside",
        [word],
        200,
        200,
        30,
        10,
        90,
        40,
        40,
        40,
        40,
        [(200, 230, "outside")],
    )


class VisualObjectTests(unittest.TestCase):
    def test_empty_fragment_and_outside_text_region_are_safe_noops(self) -> None:
        empty_rgb = np.empty((0, 0, 3), dtype=np.uint8)
        empty_mask = np.empty((0, 0), dtype=np.uint8)
        self.assertFalse(save_transparent_fragment(empty_rgb, empty_mask, "unused.png"))

        image = np.zeros((40, 40, 3), dtype=np.uint8)
        remove_text_regions_rgb(image, [outside_line()])
        self.assertEqual(int(np.count_nonzero(image)), 0)

    def test_segmenter_preserves_large_monochrome_artwork_as_transparent_image(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "page.png")
            image = Image.new("RGB", (500, 320), "white")
            ImageDraw.Draw(image).ellipse((120, 80, 240, 200), fill=(25, 25, 25))
            image.save(source)

            fragments, rules = segment_visual_layer(str(source), tmp, 0, [], 500, 320)

            self.assertEqual(rules, [])
            self.assertEqual(len(fragments), 1)
            self.assertEqual(fragments[0].kind, "image")
            self.assertTrue(Path(fragments[0].path).exists())
            with Image.open(fragments[0].path) as fragment:
                self.assertEqual(fragment.mode, "RGBA")
                self.assertGreater(fragment.width, 120)
                self.assertGreater(fragment.height, 120)


if __name__ == "__main__":
    unittest.main()
