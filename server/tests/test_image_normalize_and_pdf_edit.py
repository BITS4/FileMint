"""Tests for image normalization and permanent PDF redaction helpers."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from PIL import Image

from server import image_normalize, pdf_edit


class ImageNormalizeTests(unittest.TestCase):
    def test_filters_cover_grayscale_bw_contrast_and_passthrough(self) -> None:
        image = Image.new("RGB", (2, 1))
        image.putdata([(100, 100, 100), (200, 200, 200)])

        grayscale = image_normalize.apply_filter(image, "grayscale")
        black_white = image_normalize.apply_filter(image, "bw")
        contrast = image_normalize.apply_filter(image, "contrast")

        self.assertEqual(grayscale.mode, "RGB")
        self.assertEqual(
            [black_white.getpixel((0, 0)), black_white.getpixel((1, 0))],
            [(0, 0, 0), (255, 255, 255)],
        )
        self.assertEqual(contrast.mode, "RGB")
        self.assertIs(image_normalize.apply_filter(image, "none"), image)

    def test_normalize_preserves_alpha_and_applies_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "alpha.png")
            target = Path(tmp, "normalized.png")
            Image.new("RGBA", (3, 5), (255, 0, 0, 100)).save(source)

            report = image_normalize.normalize_image(
                str(source), str(target), rotate=90, filter_name="grayscale"
            )
            with Image.open(target) as normalized:
                self.assertEqual(normalized.size, (5, 3))
                self.assertEqual(normalized.mode, "RGB")

        self.assertEqual(report["mode"], "RGBA")
        self.assertEqual(report["rotate"], 90)
        self.assertEqual(report["frames"], 1)

    def test_normalize_rgb_and_animated_first_frame(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "animated.gif")
            target = Path(tmp, "normalized.png")
            first = Image.new("RGB", (4, 3), "red")
            second = Image.new("RGB", (4, 3), "blue")
            first.save(source, save_all=True, append_images=[second], loop=0)

            report = image_normalize.normalize_image(str(source), str(target))
            with Image.open(target) as normalized:
                self.assertEqual(normalized.mode, "RGB")
                self.assertEqual(normalized.size, (4, 3))

        self.assertEqual(report["format"], "GIF")
        self.assertEqual(report["frames"], 2)

    def test_cli_normalizes_modulo_rotation_and_optionally_writes_report(self) -> None:
        payload = {"engine": "test"}
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp, "report.json")
            argv = [
                "image_normalize",
                "--input",
                "source.heic",
                "--output",
                "target.png",
                "--rotate",
                "450",
                "--filter",
                "contrast",
                "--report",
                str(report_path),
            ]
            with (
                patch.object(sys, "argv", argv),
                patch.object(
                    image_normalize, "normalize_image", return_value=payload
                ) as normalize,
            ):
                image_normalize.main()
            normalize.assert_called_once_with(
                "source.heic", "target.png", 90, "contrast"
            )
            self.assertEqual(
                json.loads(report_path.read_text(encoding="utf-8")), payload
            )

        argv = [
            "image_normalize",
            "--input",
            "source.png",
            "--output",
            "target.png",
        ]
        with (
            patch.object(sys, "argv", argv),
            patch.object(image_normalize, "normalize_image", return_value=payload),
        ):
            image_normalize.main()


class PdfEditTests(unittest.TestCase):
    def test_hex_color_accepts_hashless_values_and_defaults_invalid_input(self) -> None:
        self.assertEqual(pdf_edit.hex_to_rgb("#FF8000"), (1.0, 128 / 255, 0.0))
        self.assertEqual(pdf_edit.hex_to_rgb("00ff00"), (0.0, 1.0, 0.0))
        self.assertEqual(pdf_edit.hex_to_rgb("not-a-color"), (0.0, 0.0, 0.0))
        self.assertEqual(pdf_edit.hex_to_rgb(""), (0.0, 0.0, 0.0))

    def test_redact_skips_invalid_pages_and_retries_legacy_pymupdf(self) -> None:
        page = MagicMock()
        page.rect = SimpleNamespace(width=200, height=100)
        page.apply_redactions.side_effect = [TypeError("legacy"), None]
        document = MagicMock()
        document.page_count = 1
        document.__getitem__.return_value = page
        document.set_metadata.side_effect = RuntimeError("metadata locked")
        areas = json.dumps(
            [
                {"page": -1},
                {"page": 4},
                {"page": 0, "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            ]
        )

        with patch.object(pdf_edit.fitz, "open", return_value=document):
            pdf_edit.redact(
                Path("source.pdf"), Path("target.pdf"), areas, "#336699", "Secret"
            )

        document.__getitem__.assert_called_once_with(0)
        annotation = page.add_redact_annot.call_args
        box = annotation.args[0]
        self.assertEqual((box.x0, box.y0, box.x1, box.y1), (20, 20, 80, 60))
        self.assertEqual(annotation.kwargs["text"], "Secret")
        self.assertEqual(page.apply_redactions.call_count, 2)
        document.save.assert_called_once_with(
            Path("target.pdf"), garbage=4, deflate=True, clean=True
        )
        document.close.assert_called_once()

    def test_redact_repairs_unquoted_json_and_uses_default_geometry(self) -> None:
        page = MagicMock()
        page.rect = SimpleNamespace(width=100, height=200)
        document = MagicMock(page_count=1)
        document.__getitem__.return_value = page
        malformed = "[{page:0, x:0.2, y:0.3, width:0.4, height:0.1}]"

        with patch.object(pdf_edit.fitz, "open", return_value=document):
            pdf_edit.redact(
                Path("source.pdf"), Path("target.pdf"), malformed, "bad", ""
            )

        annotation = page.add_redact_annot.call_args
        box = annotation.args[0]
        self.assertEqual((box.x0, box.y0, box.x1, box.y1), (20, 60, 60, 80))
        self.assertEqual(annotation.kwargs["text"], "")
        page.apply_redactions.assert_called_once()

    def test_cli_dispatches_redaction_arguments(self) -> None:
        argv = [
            "pdf_edit",
            "--task",
            "redact",
            "--input",
            "source.pdf",
            "--output",
            "target.pdf",
            "--areas-json",
            "[]",
            "--color",
            "#abcdef",
            "--label",
            "Private",
        ]
        with (
            patch.object(sys, "argv", argv),
            patch.object(pdf_edit, "redact") as redact,
        ):
            pdf_edit.main()
        redact.assert_called_once_with(
            Path("source.pdf"), Path("target.pdf"), "[]", "#abcdef", "Private"
        )


if __name__ == "__main__":
    unittest.main()
