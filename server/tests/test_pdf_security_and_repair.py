"""Tests for PDF encryption, permissions, unlocking, and repair helpers."""

from __future__ import annotations

import sys
import unittest
from unittest.mock import MagicMock, call, patch

from server import pdf_repair, pdf_security


class PdfRepairTests(unittest.TestCase):
    def test_repair_saves_clean_copy_and_always_closes_document(self) -> None:
        document = MagicMock(needs_pass=False)
        with patch.object(pdf_repair.fitz, "open", return_value=document):
            pdf_repair.repair_pdf("source.pdf", "target.pdf")
        document.save.assert_called_once_with(
            "target.pdf", garbage=4, clean=True, deflate=True
        )
        document.close.assert_called_once()

        failing = MagicMock(needs_pass=False)
        failing.save.side_effect = OSError("disk full")
        with (
            patch.object(pdf_repair.fitz, "open", return_value=failing),
            self.assertRaisesRegex(OSError, "disk full"),
        ):
            pdf_repair.repair_pdf("source.pdf", "target.pdf")
        failing.close.assert_called_once()

    def test_repair_rejects_encrypted_input_and_cli_dispatches_paths(self) -> None:
        encrypted = MagicMock(needs_pass=True)
        with (
            patch.object(pdf_repair.fitz, "open", return_value=encrypted),
            self.assertRaisesRegex(ValueError, "encrypted"),
        ):
            pdf_repair.repair_pdf("locked.pdf", "target.pdf")
        encrypted.save.assert_not_called()
        encrypted.close.assert_called_once()

        argv = [
            "pdf_repair",
            "--input",
            "source.pdf",
            "--output",
            "target.pdf",
        ]
        with (
            patch.object(sys, "argv", argv),
            patch.object(pdf_repair, "repair_pdf") as repair,
        ):
            pdf_repair.main()
        repair.assert_called_once_with("source.pdf", "target.pdf")


class PdfSecurityTests(unittest.TestCase):
    def test_open_pdf_returns_plain_or_authenticated_documents(self) -> None:
        plain = MagicMock(needs_pass=False)
        encrypted = MagicMock(needs_pass=True)
        encrypted.authenticate.return_value = 4
        with patch.object(pdf_security.fitz, "open", side_effect=[plain, encrypted]):
            self.assertIs(pdf_security.open_pdf("plain.pdf"), plain)
            self.assertIs(pdf_security.open_pdf("locked.pdf", "correct"), encrypted)
        encrypted.authenticate.assert_called_once_with("correct")

    def test_open_pdf_closes_on_missing_or_wrong_password(self) -> None:
        missing = MagicMock(needs_pass=True)
        wrong = MagicMock(needs_pass=True)
        wrong.authenticate.return_value = 0
        with patch.object(pdf_security.fitz, "open", side_effect=[missing, wrong]):
            with self.assertRaisesRegex(ValueError, "current password"):
                pdf_security.open_pdf("locked.pdf")
            with self.assertRaisesRegex(ValueError, "Wrong password"):
                pdf_security.open_pdf("locked.pdf", "wrong")
        missing.close.assert_called_once()
        wrong.close.assert_called_once()

    def test_lock_requires_password_and_closes_after_success_or_failure(self) -> None:
        with self.assertRaisesRegex(ValueError, "password is required"):
            pdf_security.save_locked("source.pdf", "target.pdf", "")

        success = MagicMock()
        failure = MagicMock()
        failure.save.side_effect = OSError("write failed")
        with patch.object(pdf_security, "open_pdf", side_effect=[success, failure]):
            pdf_security.save_locked("source.pdf", "locked.pdf", "secret")
            with self.assertRaisesRegex(OSError, "write failed"):
                pdf_security.save_locked("source.pdf", "locked.pdf", "secret")

        success.save.assert_called_once_with(
            "locked.pdf",
            garbage=4,
            deflate=True,
            encryption=pdf_security.fitz.PDF_ENCRYPT_AES_256,
            owner_pw="secret",
            user_pw="secret",
            permissions=pdf_security.ALL_PERMISSIONS,
        )
        success.close.assert_called_once()
        failure.close.assert_called_once()

    def test_unlock_removes_encryption_and_closes_on_failure(self) -> None:
        success = MagicMock()
        failure = MagicMock()
        failure.save.side_effect = RuntimeError("cannot save")
        with patch.object(
            pdf_security, "open_pdf", side_effect=[success, failure]
        ) as open_pdf:
            pdf_security.save_unlocked("locked.pdf", "plain.pdf", "secret")
            with self.assertRaisesRegex(RuntimeError, "cannot save"):
                pdf_security.save_unlocked("locked.pdf", "plain.pdf", "secret")

        self.assertEqual(
            open_pdf.call_args_list,
            [call("locked.pdf", "secret"), call("locked.pdf", "secret")],
        )
        success.save.assert_called_once_with(
            "plain.pdf",
            garbage=4,
            deflate=True,
            encryption=pdf_security.fitz.PDF_ENCRYPT_NONE,
        )
        success.close.assert_called_once()
        failure.close.assert_called_once()

    def test_permissions_require_owner_password_and_build_requested_mask(self) -> None:
        with self.assertRaisesRegex(ValueError, "owner password"):
            pdf_security.save_permissions(
                "source.pdf", "target.pdf", "", allow_print=True, allow_copy=True
            )

        documents = [MagicMock(), MagicMock(), MagicMock()]
        with patch.object(pdf_security, "open_pdf", side_effect=documents):
            pdf_security.save_permissions(
                "source.pdf", "print.pdf", "owner", True, False
            )
            pdf_security.save_permissions(
                "source.pdf", "copy.pdf", "owner", False, True
            )
            pdf_security.save_permissions(
                "source.pdf", "none.pdf", "owner", False, False
            )

        expected = [
            pdf_security.fitz.PDF_PERM_PRINT,
            pdf_security.fitz.PDF_PERM_COPY,
            0,
        ]
        for document, permission in zip(documents, expected, strict=True):
            self.assertEqual(document.save.call_args.kwargs["permissions"], permission)
            document.close.assert_called_once()

    def test_security_cli_dispatches_all_tasks(self) -> None:
        base = [
            "pdf_security",
            "--input",
            "source.pdf",
            "--output",
            "target.pdf",
        ]
        with (
            patch.object(
                sys, "argv", [*base, "--task", "lock", "--password", "secret"]
            ),
            patch.object(pdf_security, "save_locked") as locked,
        ):
            pdf_security.main()
        locked.assert_called_once_with("source.pdf", "target.pdf", "secret")

        with (
            patch.object(
                sys, "argv", [*base, "--task", "unlock", "--password", "secret"]
            ),
            patch.object(pdf_security, "save_unlocked") as unlocked,
        ):
            pdf_security.main()
        unlocked.assert_called_once_with("source.pdf", "target.pdf", "secret")

        with (
            patch.object(
                sys,
                "argv",
                [
                    *base,
                    "--task",
                    "permissions",
                    "--owner-password",
                    "owner",
                    "--allow-print",
                    "--allow-copy",
                ],
            ),
            patch.object(pdf_security, "save_permissions") as permissions,
        ):
            pdf_security.main()
        permissions.assert_called_once_with(
            "source.pdf", "target.pdf", "owner", True, True
        )


if __name__ == "__main__":
    unittest.main()
