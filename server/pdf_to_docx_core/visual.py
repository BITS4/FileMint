"""Residual-image and vector-like visual layer segmentation."""

from __future__ import annotations

import os
from typing import Any

from .models import LineBox, VisualFragment, VisualRule


def make_residual_image(src_png: str, dst_png: str, lines: list[LineBox]) -> None:
    from PIL import Image, ImageDraw

    img = Image.open(src_png).convert("RGB")
    draw = ImageDraw.Draw(img)
    for line in lines:
        pad_x = max(3, int(line.height * 0.18))
        pad_y = max(3, int(line.height * 0.22))
        draw.rectangle(
            [
                max(0, int(line.left - pad_x)),
                max(0, int(line.top - pad_y)),
                min(img.width, int(line.left + line.width + pad_x)),
                min(img.height, int(line.top + line.height + pad_y)),
            ],
            fill=(255, 255, 255),
        )
    img.save(dst_png)


def remove_text_regions_rgb(arr: Any, lines: list[LineBox]) -> None:
    for line in lines:
        pad_x = max(5, int(line.height * 0.45))
        pad_y = max(5, int(line.height * 0.55))
        left = max(0, int(line.left - pad_x))
        top = max(0, int(line.top - pad_y))
        right = min(arr.shape[1], int(line.left + line.width + pad_x))
        bottom = min(arr.shape[0], int(line.top + line.height + pad_y))
        if right > left and bottom > top:
            arr[top:bottom, left:right] = 255


def color_hex_from_region(
    arr: Any, left: int, top: int, right: int, bottom: int
) -> str:
    region = arr[max(0, top) : max(0, bottom), max(0, left) : max(0, right)]
    if region.size == 0:
        return "#AEB6BC"
    import numpy as np

    flat = region.reshape(-1, 3)
    nonwhite = flat[np.any(flat < 235, axis=1)]
    if len(nonwhite) == 0:
        return "#AEB6BC"
    rgb = np.median(nonwhite, axis=0).astype(int)
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def save_transparent_fragment(arr: Any, mask: Any, path: str) -> bool:
    from PIL import Image
    import numpy as np

    if arr.size == 0:
        return False
    alpha = np.where(mask > 0, 255, 0).astype("uint8")
    if int(np.count_nonzero(alpha)) < 20:
        return False
    rgba = np.dstack([arr, alpha])
    Image.fromarray(rgba, "RGBA").save(path)
    return True


def merge_visual_rules(rules: list[VisualRule]) -> list[VisualRule]:
    merged: list[VisualRule] = []
    for rule in sorted(rules, key=lambda r: (round(r.top, 1), r.left)):
        if merged:
            prev = merged[-1]
            same_row = (
                abs((prev.top + prev.height / 2) - (rule.top + rule.height / 2))
                <= max(1.0, prev.height, rule.height) * 1.4
            )
            close = rule.left <= prev.left + prev.width + 4.0
            if same_row and close and prev.color == rule.color:
                right = max(prev.left + prev.width, rule.left + rule.width)
                prev.left = min(prev.left, rule.left)
                prev.width = right - prev.left
                prev.top = min(prev.top, rule.top)
                prev.height = max(prev.height, rule.height)
                continue
        merged.append(rule)
    return merged


def segment_visual_layer(
    src_png: str,
    dst_dir: str,
    page_index: int,
    editable_lines: list[LineBox],
    page_width_pt: float,
    page_height_pt: float,
) -> tuple[list[VisualFragment], list[VisualRule]]:
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except Exception as e:
        raise RuntimeError(f"OpenCV image segmentation is unavailable: {e}")

    img = Image.open(src_png).convert("RGB")
    original_arr = np.array(img)
    arr = original_arr.copy()
    height_px, width_px = arr.shape[:2]
    scale_x = page_width_pt / max(1.0, width_px)
    scale_y = page_height_pt / max(1.0, height_px)

    fragments: list[VisualFragment] = []
    original_hsv = cv2.cvtColor(original_arr, cv2.COLOR_RGB2HSV)
    color_delta = original_arr.max(axis=2) - original_arr.min(axis=2)
    colored_mask = np.where(
        (original_hsv[:, :, 1] > 34)
        & (original_hsv[:, :, 2] < 252)
        & (color_delta > 28),
        255,
        0,
    ).astype("uint8")
    color_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    colored_components = cv2.dilate(
        cv2.morphologyEx(colored_mask, cv2.MORPH_CLOSE, color_kernel, iterations=1),
        color_kernel,
        iterations=2,
    )
    color_count, color_labels, color_stats, _ = cv2.connectedComponentsWithStats(
        colored_components, 8
    )
    for label in range(1, color_count):
        x, y, w, h, area = color_stats[label]
        if area < 180 or w < 14 or h < 14 or max(w, h) < 30:
            continue
        if w * h > width_px * height_px * 0.18:
            continue
        pad = max(4, min(20, int(max(w, h) * 0.035)))
        left = max(0, x - pad)
        top = max(0, y - pad)
        right = min(width_px, x + w + pad)
        bottom = min(height_px, y + h + pad)
        crop = original_arr[top:bottom, left:right].copy()
        crop_mask = colored_mask[top:bottom, left:right].copy()
        fragment_path = os.path.join(
            dst_dir, f"page-{page_index + 1}-color-fragment-{len(fragments) + 1}.png"
        )
        if save_transparent_fragment(crop, crop_mask, fragment_path):
            fragments.append(
                VisualFragment(
                    path=fragment_path,
                    left=left * scale_x,
                    top=top * scale_y,
                    width=(right - left) * scale_x,
                    height=(bottom - top) * scale_y,
                    kind="colored-mark",
                )
            )
        region = arr[top:bottom, left:right]
        region[crop_mask > 0] = 255
        arr[top:bottom, left:right] = region

    remove_text_regions_rgb(arr, editable_lines)

    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    dark = np.where(gray < 224, 255, 0).astype("uint8")
    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (max(45, width_px // 48), 1)
    )
    horizontal = cv2.morphologyEx(dark, cv2.MORPH_OPEN, horizontal_kernel)
    contours, _ = cv2.findContours(
        horizontal, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    rules: list[VisualRule] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w < max(70, width_px * 0.035):
            continue
        if h > max(14, height_px * 0.006):
            continue
        color = color_hex_from_region(arr, x, y, x + w, y + h)
        rules.append(
            VisualRule(
                left=x * scale_x,
                top=y * scale_y,
                width=w * scale_x,
                height=max(0.45, h * scale_y),
                color=color,
            )
        )
        pad = 2
        arr[
            max(0, y - pad) : min(height_px, y + h + pad),
            max(0, x - pad) : min(width_px, x + w + pad),
        ] = 255

    rules = merge_visual_rules(rules)

    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    mask = np.where((gray < 244) | ((saturation > 24) & (value < 252)), 255, 0).astype(
        "uint8"
    )
    mask[:3, :] = 0
    mask[-3:, :] = 0
    mask[:, :3] = 0
    mask[:, -3:] = 0
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    connected_mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    connected_mask = cv2.dilate(connected_mask, kernel, iterations=2)
    count, labels, stats, _centroids = cv2.connectedComponentsWithStats(
        connected_mask, 8
    )

    page_area = width_px * height_px
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        bbox_area = w * h
        if area < 520 or bbox_area < 1400 or w < 10 or h < 10:
            continue
        if max(w, h) < 48:
            continue
        if w * h > page_area * 0.42:
            continue
        if h <= 4 and w > 40:
            continue
        density = area / max(1, bbox_area)
        if density < 0.02 and max(w, h) < 220:
            continue

        pad = max(3, min(18, int(max(w, h) * 0.04)))
        left = max(0, x - pad)
        top = max(0, y - pad)
        right = min(width_px, x + w + pad)
        bottom = min(height_px, y + h + pad)
        crop = arr[top:bottom, left:right].copy()
        crop_mask = mask[top:bottom, left:right].copy()
        if int(np.count_nonzero(crop_mask)) < 25:
            continue
        fragment_path = os.path.join(
            dst_dir, f"page-{page_index + 1}-fragment-{len(fragments) + 1}.png"
        )
        if not save_transparent_fragment(crop, crop_mask, fragment_path):
            continue
        fragments.append(
            VisualFragment(
                path=fragment_path,
                left=left * scale_x,
                top=top * scale_y,
                width=(right - left) * scale_x,
                height=(bottom - top) * scale_y,
            )
        )

    fragments.sort(key=lambda f: (f.top, f.left))
    return fragments, rules
