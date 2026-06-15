#!/usr/bin/env python3
"""Normalize an image to PNG for FileMint client tools."""

from __future__ import annotations

import argparse
import json
from typing import Any

from PIL import Image, ImageOps, ImageSequence

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:
    pass


def apply_filter(image: Image.Image, filter_name: str) -> Image.Image:
    if filter_name == "grayscale":
        return image.convert("L").convert("RGB")
    if filter_name == "bw":
        return image.convert("L").point(lambda p: 255 if p > 150 else 0).convert("RGB")
    if filter_name == "contrast":
        from PIL import ImageEnhance

        return ImageEnhance.Contrast(image).enhance(1.35)
    return image


def normalize_image(src: str, dst: str, rotate: int = 0, filter_name: str = "none") -> dict[str, Any]:
    with Image.open(src) as image:
        first = next(ImageSequence.Iterator(image))
        first = ImageOps.exif_transpose(first)
        if rotate:
            first = first.rotate(-rotate, expand=True)
        original_mode = first.mode
        if first.mode in {"RGBA", "LA"} or ("transparency" in first.info):
            first = first.convert("RGBA")
        else:
            first = first.convert("RGB")
        first = apply_filter(first, filter_name)
        first.save(dst, "PNG", optimize=True)
        return {
            "engine": "filemint-image-normalize",
            "format": image.format,
            "width": first.width,
            "height": first.height,
            "mode": original_mode,
            "frames": getattr(image, "n_frames", 1),
            "filter": filter_name,
            "rotate": rotate,
            "notes": ["Image normalized to PNG for PDF/OCR compatibility."],
            "warnings": [],
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--rotate", type=int, default=0)
    parser.add_argument("--filter", default="none", choices=["none", "grayscale", "contrast", "bw"])
    parser.add_argument("--report")
    args = parser.parse_args()

    report = normalize_image(args.input, args.output, args.rotate % 360, args.filter)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
