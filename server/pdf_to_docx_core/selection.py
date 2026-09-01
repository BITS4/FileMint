"""Pure OCR confidence, de-duplication, and candidate selection."""

from __future__ import annotations

import re
from typing import Any

from .docx import (
    editable_confidence_threshold,
    line_is_confident,
    line_text_signal,
    premium_confidence_threshold,
)
from .models import LineBox, WordBox
from .ocr import normalize_ocr_text, script_counts


def line_overlaps_colored_mark(img: Any, line: LineBox) -> bool:
    pad = max(6, int(line.height * 0.35))
    left = max(0, int(line.left - pad))
    top = max(0, int(line.top - pad))
    right = min(img.width, int(line.left + line.width + pad))
    bottom = min(img.height, int(line.top + line.height + pad))
    if right <= left or bottom <= top:
        return False

    total = 0
    colorful = 0
    step = max(1, int(max(right - left, bottom - top) / 80))
    pixels = img.load()
    for y in range(top, bottom, step):
        for x in range(left, right, step):
            r, g, b = pixels[x, y]
            if r > 235 and g > 235 and b > 235:
                continue
            total += 1
            if max(r, g, b) - min(r, g, b) > 38:
                colorful += 1
    return total > 0 and (colorful / total) > 0.08


def exact_editable_lines(
    src_png: str,
    lines: list[LineBox],
    lang: str,
    premium: bool = False,
) -> tuple[list[LineBox], dict[str, int]]:
    from PIL import Image

    img = Image.open(src_png).convert("RGB")
    editable: list[LineBox] = []
    stats = {
        "ocrTextCandidates": 0,
        "editableTextBoxes": 0,
        "editableCharacters": 0,
        "skippedColoredMarks": 0,
        "skippedLowConfidence": 0,
        "skippedNoise": 0,
    }
    min_conf = (
        premium_confidence_threshold(lang)
        if premium
        else editable_confidence_threshold(lang)
    )
    for line in lines:
        if not line_text_signal(line):
            continue
        if probable_ocr_noise(line, lang):
            stats["skippedNoise"] += 1
            continue
        if line_overlaps_colored_mark(img, line) and (not premium or line.conf < 62):
            stats["skippedColoredMarks"] += 1
            continue
        stats["ocrTextCandidates"] += 1
        if not line_is_confident(line, min_conf):
            stats["skippedLowConfidence"] += 1
            continue
        editable.append(line)
    stats["editableTextBoxes"] = len(editable)
    stats["editableCharacters"] = sum(len(line.text) for line in editable)
    return editable, stats


def word_as_line(word: WordBox, parent: LineBox) -> LineBox:
    return LineBox(
        text=word.text,
        words=[word],
        left=word.left,
        top=word.top,
        width=word.width,
        height=word.height,
        conf=word.conf,
        page_width_px=parent.page_width_px,
        page_height_px=parent.page_height_px,
        page_width_pt=parent.page_width_pt,
        page_height_pt=parent.page_height_pt,
        segments=[(word.left, word.left + word.width, word.text)],
    )


def is_duplicate_word_line(candidate: LineBox, existing: list[LineBox]) -> bool:
    for line in existing:
        if candidate.text.strip().lower() != line.text.strip().lower():
            continue
        x_overlap = min(candidate.left + candidate.width, line.left + line.width) - max(
            candidate.left, line.left
        )
        y_overlap = min(candidate.top + candidate.height, line.top + line.height) - max(
            candidate.top, line.top
        )
        if x_overlap <= 0 or y_overlap <= 0:
            continue
        overlap = x_overlap * y_overlap
        smaller = max(
            1.0, min(candidate.width * candidate.height, line.width * line.height)
        )
        if overlap / smaller > 0.45:
            return True
    return False


def dense_table_scan_likely(lines: list[LineBox]) -> bool:
    total_words = sum(len(line.words) for line in lines)
    segmented_rows = sum(1 for line in lines if len(line.segments) >= 3)
    numeric_grade_lines = sum(1 for line in lines if re.search(r"\d+/\d+", line.text))
    if (
        len(lines) >= 24
        and total_words >= 80
        and (segmented_rows >= 10 or numeric_grade_lines >= 6)
    ):
        return True
    if len(lines) < 80:
        return False
    y_positions = sorted(line.top for line in lines if line.height > 0)
    if len(y_positions) < 40:
        return False
    close_rows = 0
    last_y: float | None = None
    for y in y_positions:
        if last_y is not None and y - last_y < 42:
            close_rows += 1
        last_y = y
    return close_rows >= 35 or numeric_grade_lines >= 8


def transcript_scan_likely(lines: list[LineBox]) -> bool:
    """Return true only for the known school-transcript layout.

    The transcript rebuilder below is intentionally template-specific. It must
    never run on generic scans just because OCR sees many rows or numbers.
    """
    text = normalize_ocr_text(" ".join(line.text for line in lines)).lower()
    if not text:
        return False
    title_signals = [
        "student personal",
        "personal information",
        "academic record",
        "course title",
        "average grade",
    ]
    grade_headers = [
        "grade 9",
        "grade 10",
        "grade 11",
        "half-year",
        "half year",
    ]
    school_terms = [
        "student",
        "academic",
        "course",
        "grade",
        "graduation",
        "principal",
        "lyceum",
        "school",
        "language",
    ]
    title_score = sum(1 for signal in title_signals if signal in text)
    header_score = sum(1 for signal in grade_headers if signal in text)
    school_score = sum(1 for signal in school_terms if signal in text)
    grade_mark_count = len(re.findall(r"\b(?:5/5|4/5|8/10|9/10|10/10)\b", text))
    return (
        title_score >= 2
        and header_score >= 2
        and school_score >= 4
        and grade_mark_count >= 4
    )


def transcript_rebuild_likely(
    lines: list[LineBox], grid_geometry: dict[str, Any] | None = None
) -> bool:
    if transcript_scan_likely(lines):
        return True
    if not grid_geometry:
        return False
    if (
        len(grid_geometry.get("xPositionsPx") or []) < 6
        or len(grid_geometry.get("yPositionsPx") or []) < 8
    ):
        return False
    text = normalize_ocr_text(" ".join(line.text for line in lines)).lower()
    if not text:
        return False
    layout_terms = ["student", "personal", "academic", "course", "grade", "average"]
    grade_marks = len(re.findall(r"\b(?:5/5|4/5|8/10|9/10|10/10)\b", text))
    term_score = sum(1 for term in layout_terms if term in text)
    if grade_marks >= 4 and len(lines) >= 16:
        return True
    return term_score >= 3 and (
        grade_marks >= 2 or ("course" in text and "grade" in text)
    )


def exact_editable_word_lines(
    src_png: str,
    lines: list[LineBox],
    lang: str,
    premium: bool = False,
) -> tuple[list[LineBox], dict[str, int]]:
    from PIL import Image

    img = Image.open(src_png).convert("RGB")
    editable: list[LineBox] = []
    stats = {
        "ocrTextCandidates": 0,
        "editableTextBoxes": 0,
        "editableCharacters": 0,
        "skippedColoredMarks": 0,
        "skippedLowConfidence": 0,
        "skippedNoise": 0,
    }
    min_conf = (
        premium_confidence_threshold(lang)
        if premium
        else editable_confidence_threshold(lang)
    )
    for line in lines:
        for word in line.words:
            word_line = word_as_line(word, line)
            if not line_text_signal(word_line):
                continue
            if probable_ocr_noise(word_line, lang):
                stats["skippedNoise"] += 1
                continue
            if line_overlaps_colored_mark(img, word_line) and (
                not premium or word_line.conf < 62
            ):
                stats["skippedColoredMarks"] += 1
                continue
            stats["ocrTextCandidates"] += 1
            if not line_is_confident(word_line, min_conf):
                stats["skippedLowConfidence"] += 1
                continue
            if is_duplicate_word_line(word_line, editable):
                continue
            editable.append(word_line)

    editable.sort(key=lambda line: (line.top, line.left))
    stats["editableTextBoxes"] = len(editable)
    stats["editableCharacters"] = sum(len(line.text) for line in editable)
    return editable, stats


def line_should_be_bold(line: LineBox) -> bool:
    letters = [ch for ch in line.text if ch.isalpha()]
    uppercase = sum(1 for ch in letters if ch.upper() == ch)
    near_top = line.top < line.page_height_px * 0.12
    return bool(letters) and (near_top or uppercase / max(1, len(letters)) > 0.72)


def line_overlap_ratio(a: LineBox, b: LineBox) -> float:
    left = max(a.left, b.left)
    top = max(a.top, b.top)
    right = min(a.left + a.width, b.left + b.width)
    bottom = min(a.top + a.height, b.top + b.height)
    if right <= left or bottom <= top:
        return 0.0
    overlap = (right - left) * (bottom - top)
    smaller = max(1.0, min(a.width * a.height, b.width * b.height))
    return overlap / smaller


def duplicate_line_indices(candidate: LineBox, existing: list[LineBox]) -> list[int]:
    indices: list[int] = []
    for idx, line in enumerate(existing):
        vertical_overlap = min(
            candidate.top + candidate.height, line.top + line.height
        ) - max(candidate.top, line.top)
        if vertical_overlap <= 0:
            continue
        vertical_ratio = vertical_overlap / max(1.0, min(candidate.height, line.height))
        center_distance = abs(
            (candidate.left + candidate.width / 2) - (line.left + line.width / 2)
        )
        close_centers = center_distance <= max(candidate.width, line.width) * 0.28
        if line_overlap_ratio(candidate, line) > 0.45 or (
            vertical_ratio > 0.7 and close_centers
        ):
            indices.append(idx)
    return indices


def is_duplicate_line(candidate: LineBox, existing: list[LineBox]) -> bool:
    return bool(duplicate_line_indices(candidate, existing))


def probable_ocr_noise(line: LineBox, lang: str) -> bool:
    text = normalize_ocr_text(line.text)
    if not text:
        return True
    counts = script_counts(text)
    parts = set(p for p in re.split(r"[,+\s]+", lang) if p)
    if (
        line.conf < 35
        and counts["digits"] == 0
        and counts["cjk"] == 0
        and counts["rtl"] == 0
        and len(text) <= 16
    ):
        return True
    if (
        counts["latin"] <= 2
        and counts["digits"] == 0
        and counts["cjk"] == 0
        and counts["rtl"] == 0
        and len(text) <= 3
        and line.width < max(90.0, line.height * 2.2)
    ):
        return True
    if parts & {"chi_sim", "chi_tra"}:
        uppercase_words = re.findall(r"\b[A-Z]{2,}\b", text)
        if (
            counts["cjk"] == 0
            and counts["digits"] == 0
            and len(uppercase_words) >= 3
            and line.conf < 52
        ):
            return True
    return False


def line_quality_score(line: LineBox, lang: str) -> float:
    counts = script_counts(line.text)
    score = max(0.0, line.conf)
    score += min(14.0, counts["cjk"] * 0.22)
    score += min(7.0, counts["latin"] * 0.035)
    score += min(5.0, counts["digits"] * 0.12)
    if probable_ocr_noise(line, lang):
        score -= 60.0
    return score


def merge_line_candidates(
    existing: list[LineBox], candidates: list[LineBox], lang: str
) -> list[LineBox]:
    merged = existing[:]
    for candidate in candidates:
        duplicate_indices = duplicate_line_indices(candidate, merged)
        if not duplicate_indices:
            merged.append(candidate)
            continue

        candidate_score = line_quality_score(candidate, lang)
        existing_scores = [
            line_quality_score(merged[i], lang) for i in duplicate_indices
        ]
        replace_bonus = 8.0 if len(duplicate_indices) > 1 else 0.0
        if candidate_score + replace_bonus > max(existing_scores) + 3.0:
            for idx in sorted(duplicate_indices, reverse=True):
                del merged[idx]
            merged.append(candidate)

    return sorted(merged, key=lambda l: (l.top, l.left))
