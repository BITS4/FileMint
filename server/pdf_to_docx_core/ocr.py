"""Tesseract TSV parsing, row reconstruction, and language scoring."""

from __future__ import annotations

import csv
import os
import re
import subprocess
from statistics import median

from .config import FAST_HOSTED_OCR
from .models import LineBox, WordBox
from .native import xml_compatible_text
from .runtime import find_tesseract, tessdata_dir_for_lang

CJK_RANGE = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"


def normalize_ocr_text(text: str) -> str:
    text = xml_compatible_text(text)
    text = re.sub(r"\s+", " ", text).strip()
    previous = None
    while previous != text:
        previous = text
        text = re.sub(rf"([{CJK_RANGE}])\s+([{CJK_RANGE}])", r"\1\2", text)
    text = re.sub(rf"([{CJK_RANGE}])\s+([，。！？；：、])", r"\1\2", text)
    text = re.sub(rf"([，。！？；：、])\s+([{CJK_RANGE}])", r"\1\2", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def parse_tsv(
    tsv: str,
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
) -> list[LineBox]:
    tsv = tsv.replace("\f", "\n")
    rows = list(csv.DictReader(tsv.splitlines(), delimiter="\t"))
    grouped: dict[tuple[int, int, int], list[WordBox]] = {}
    all_words: list[WordBox] = []
    for row in rows:
        try:
            if int(row.get("level", "0")) != 5:
                continue
            text = (row.get("text") or "").strip()
            if not text:
                continue
            if "\t" in text:
                text = text.split("\t", 1)[0].strip()
            if not text:
                continue
            conf = float(row.get("conf") or -1)
            word = WordBox(
                text=text,
                left=float(row.get("left") or 0),
                top=float(row.get("top") or 0),
                width=float(row.get("width") or 0),
                height=float(row.get("height") or 0),
                conf=conf,
                block=int(row.get("block_num") or 0),
                par=int(row.get("par_num") or 0),
                line=int(row.get("line_num") or 0),
            )
            all_words.append(word)
            grouped.setdefault((word.block, word.par, word.line), []).append(word)
        except Exception:
            continue

    lines: list[LineBox] = []
    for words in grouped.values():
        words = sorted(words, key=lambda w: w.left)
        left = min(w.left for w in words)
        top = min(w.top for w in words)
        right = max(w.left + w.width for w in words)
        bottom = max(w.top + w.height for w in words)
        confs = [w.conf for w in words if w.conf >= 0]
        text = normalize_ocr_text(" ".join(w.text for w in words))
        lines.append(
            LineBox(
                text=text,
                words=words,
                left=left,
                top=top,
                width=right - left,
                height=bottom - top,
                conf=sum(confs) / len(confs) if confs else -1,
                page_width_px=page_width_px,
                page_height_px=page_height_px,
                page_width_pt=page_width_pt,
                page_height_pt=page_height_pt,
                segments=segment_line(words),
            )
        )
    if all_words and (
        len(lines) < 8 or max((len(line.words) for line in lines), default=0) > 45
    ):
        rebuilt = rebuild_rows_from_word_geometry(
            all_words, page_width_px, page_height_px, page_width_pt, page_height_pt
        )
        if len(rebuilt) > len(lines) * 2:
            return rebuilt
    return sorted(lines, key=lambda l: (l.top, l.left))


def rebuild_rows_from_word_geometry(
    words: list[WordBox],
    page_width_px: float,
    page_height_px: float,
    page_width_pt: float,
    page_height_pt: float,
) -> list[LineBox]:
    rows: list[list[WordBox]] = []
    for word in sorted(words, key=lambda w: (w.top + w.height / 2, w.left)):
        if word.width <= 0 or word.height <= 0:
            continue
        center = word.top + word.height / 2
        placed = False
        for row in rows:
            row_center = sum(w.top + w.height / 2 for w in row) / max(1, len(row))
            row_height = median([w.height for w in row if w.height > 0]) or word.height
            if abs(center - row_center) <= max(5.0, min(18.0, row_height * 0.62)):
                row.append(word)
                placed = True
                break
        if not placed:
            rows.append([word])

    line_boxes: list[LineBox] = []
    for row in rows:
        row = sorted(row, key=lambda w: w.left)
        if not row:
            continue
        left = min(w.left for w in row)
        top = min(w.top for w in row)
        right = max(w.left + w.width for w in row)
        bottom = max(w.top + w.height for w in row)
        confs = [w.conf for w in row if w.conf >= 0]
        text = normalize_ocr_text(" ".join(w.text for w in row))
        if not text:
            continue
        line_boxes.append(
            LineBox(
                text=text,
                words=row,
                left=left,
                top=top,
                width=right - left,
                height=bottom - top,
                conf=sum(confs) / len(confs) if confs else -1,
                page_width_px=page_width_px,
                page_height_px=page_height_px,
                page_width_pt=page_width_pt,
                page_height_pt=page_height_pt,
                segments=segment_line(row),
            )
        )
    return sorted(line_boxes, key=lambda l: (l.top, l.left))


def segment_line(words: list[WordBox]) -> list[tuple[float, float, str]]:
    if not words:
        return []
    heights = [w.height for w in words if w.height > 0]
    h = median(heights) if heights else 12
    gap_limit = max(55.0, h * 3.2)
    segments: list[list[WordBox]] = [[words[0]]]
    last_right = words[0].left + words[0].width
    for w in words[1:]:
        gap = w.left - last_right
        if gap > gap_limit:
            segments.append([w])
        else:
            segments[-1].append(w)
        last_right = max(last_right, w.left + w.width)
    out: list[tuple[float, float, str]] = []
    for segment in segments:
        left = min(w.left for w in segment)
        right = max(w.left + w.width for w in segment)
        out.append((left, right, normalize_ocr_text(" ".join(w.text for w in segment))))
    return out


def run_tesseract_tsv(image: str, lang: str, psm: str = "11") -> str:
    tess = find_tesseract()
    if not tess:
        raise RuntimeError("Tesseract OCR is not installed.")
    cmd = [tess, image, "stdout", "-l", lang, "--oem", "1", "--psm", psm, "tsv"]
    tessdata_dir = tessdata_dir_for_lang(lang)
    if tessdata_dir:
        cmd[3:3] = ["--tessdata-dir", tessdata_dir]
    timeout = int(
        os.environ.get(
            "FILEMINT_TESSERACT_TIMEOUT_SEC", "30" if FAST_HOSTED_OCR else "180"
        )
    )
    try:
        r = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Tesseract OCR timed out after {timeout}s.")
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "Tesseract OCR failed.").strip())
    return r.stdout


def unique_lang(parts: list[str]) -> str:
    out: list[str] = []
    for part in parts:
        if part and part not in out:
            out.append(part)
    return "+".join(out)


def ocr_language_candidates(lang: str) -> list[str]:
    parts = [p for p in re.split(r"[,+\s]+", lang) if p]
    if FAST_HOSTED_OCR:
        preferred = ["eng", "rus", "tgk", "fas", "ara", "chi_sim", "chi_tra", "kor"]
        singles = [p for p in preferred if p in parts] + [
            p for p in parts if p not in preferred
        ]
        return [(singles or ["eng"])[0]]
    part_set = set(parts)
    candidates = [unique_lang(parts)]
    if "eng" in part_set and ("chi_sim" in part_set or "chi_tra" in part_set):
        candidates.append(
            unique_lang(["eng"] + [p for p in ("chi_sim", "chi_tra") if p in part_set])
        )
        candidates.append(
            unique_lang([p for p in ("chi_sim", "chi_tra") if p in part_set])
        )
    if "eng" in part_set and (part_set & {"rus", "tgk"}):
        candidates.append(
            unique_lang(["eng"] + [p for p in ("rus", "tgk") if p in part_set])
        )
    if "eng" in part_set and (part_set & {"fas", "ara"}):
        candidates.append(
            unique_lang(["eng"] + [p for p in ("fas", "ara") if p in part_set])
        )
    candidates.append(unique_lang(parts[:1]))
    return [c for i, c in enumerate(candidates) if c and c not in candidates[:i]]


def script_counts(text: str) -> dict[str, int]:
    return {
        "latin": len(re.findall(r"[A-Za-z]", text)),
        "cyrillic": len(re.findall(r"[\u0400-\u052f]", text)),
        "cjk": len(re.findall(rf"[{CJK_RANGE}]", text)),
        "rtl": len(re.findall(r"[\u0590-\u08ff]", text)),
        "digits": len(re.findall(r"\d", text)),
    }


def score_ocr_lines(lines: list[LineBox], lang: str) -> float:
    if not lines:
        return -1000.0
    text = " ".join(line.text for line in lines)
    counts = script_counts(text)
    confs = [max(0.0, line.conf) for line in lines if line.conf >= 0]
    avg_conf = sum(confs) / max(1, len(confs))
    signal_chars = (
        counts["latin"]
        + counts["cyrillic"]
        + counts["cjk"]
        + counts["rtl"]
        + counts["digits"]
    )
    score = avg_conf + min(16.0, signal_chars / 80.0) + min(8.0, len(lines) / 12.0)
    parts = set(p for p in re.split(r"[,+\s]+", lang) if p)
    if counts["cjk"] >= 10 and parts & {"chi_sim", "chi_tra"}:
        score += 12.0
        if parts & {"rus", "tgk"}:
            score -= min(22.0, counts["cyrillic"] / max(1.0, counts["cjk"]) * 18.0)
    if counts["rtl"] >= 10 and parts & {"fas", "ara"}:
        score += 8.0
    if counts["cyrillic"] >= 20 and parts & {"rus", "tgk"} and counts["cjk"] < 10:
        score += 8.0
    return score
