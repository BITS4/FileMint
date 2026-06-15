#!/usr/bin/env python3
"""PDF security helpers for FileMint.

Uses PyMuPDF as a bundled fallback when the qpdf CLI is not installed.
"""

from __future__ import annotations

import argparse

import fitz


ALL_PERMISSIONS = 4095


def open_pdf(path: str, password: str = "") -> fitz.Document:
    doc = fitz.open(path)
    if doc.needs_pass:
        if not password:
            doc.close()
            raise ValueError("This PDF is encrypted. Enter its current password first.")
        ok = doc.authenticate(password)
        if ok <= 0:
            doc.close()
            raise ValueError("Wrong password or unsupported PDF encryption.")
    return doc


def save_locked(src: str, dst: str, password: str) -> None:
    if not password:
        raise ValueError("A password is required.")
    doc = open_pdf(src)
    try:
        doc.save(
            dst,
            garbage=4,
            deflate=True,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=password,
            user_pw=password,
            permissions=ALL_PERMISSIONS,
        )
    finally:
        doc.close()


def save_unlocked(src: str, dst: str, password: str) -> None:
    doc = open_pdf(src, password)
    try:
        doc.save(dst, garbage=4, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)
    finally:
        doc.close()


def save_permissions(src: str, dst: str, owner_password: str, allow_print: bool, allow_copy: bool) -> None:
    if not owner_password:
        raise ValueError("An owner password is required.")
    permissions = 0
    if allow_print:
        permissions |= fitz.PDF_PERM_PRINT
    if allow_copy:
        permissions |= fitz.PDF_PERM_COPY
    doc = open_pdf(src)
    try:
        doc.save(
            dst,
            garbage=4,
            deflate=True,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=owner_password,
            user_pw="",
            permissions=permissions,
        )
    finally:
        doc.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--task", required=True, choices=["lock", "unlock", "permissions"])
    parser.add_argument("--password", default="")
    parser.add_argument("--owner-password", default="")
    parser.add_argument("--allow-print", action="store_true")
    parser.add_argument("--allow-copy", action="store_true")
    args = parser.parse_args()

    if args.task == "lock":
        save_locked(args.input, args.output, args.password)
    elif args.task == "unlock":
        save_unlocked(args.input, args.output, args.password)
    else:
        save_permissions(args.input, args.output, args.owner_password, args.allow_print, args.allow_copy)


if __name__ == "__main__":
    main()
