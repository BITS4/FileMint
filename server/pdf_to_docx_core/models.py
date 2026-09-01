"""Shared OCR geometry and visual-layer value objects."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class WordBox:
    text: str
    left: float
    top: float
    width: float
    height: float
    conf: float
    block: int
    par: int
    line: int


@dataclass
class LineBox:
    text: str
    words: list[WordBox]
    left: float
    top: float
    width: float
    height: float
    conf: float
    page_width_px: float
    page_height_px: float
    page_width_pt: float
    page_height_pt: float
    segments: list[tuple[float, float, str]]


@dataclass
class VisualFragment:
    path: str
    left: float
    top: float
    width: float
    height: float
    kind: str = "image"


@dataclass
class VisualRule:
    left: float
    top: float
    width: float
    height: float
    color: str = "#AEB6BC"
