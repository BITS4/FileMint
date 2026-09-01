#!/usr/bin/env python3
"""Repair and normalize PDF files for FileMint.

PyMuPDF can recover many PDFs while opening them, then save a clean copy with
rebuilt xrefs, garbage collection, and deflated streams.
"""

from __future__ import annotations

import argparse

import fitz


def repair_pdf(src: str, dst: str) -> None:
    doc = fitz.open(src)
    try:
        if doc.needs_pass:
            raise ValueError(
                "This PDF is encrypted. Unlock it before running Repair PDF."
            )
        doc.save(dst, garbage=4, clean=True, deflate=True)
    finally:
        doc.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    repair_pdf(args.input, args.output)


if __name__ == "__main__":
    main()
