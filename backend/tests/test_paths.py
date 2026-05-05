"""Unit tests for the shared path helpers.

These are the foundation of the path-traversal fixes — if any assertion
below breaks, a regression in upload / rename / serve routes is almost
certainly reintroduced.
"""

from pathlib import Path

import pytest

from asclepius.util.paths import (
    UnsafePathError,
    is_within,
    safe_filename,
    safe_vault_join,
)


class TestSafeFilename:
    def test_strips_directory_components(self):
        assert safe_filename("foo/bar.pdf") == "bar.pdf"
        assert safe_filename("..\\..\\etc\\passwd") == "passwd"

    def test_rejects_traversal(self):
        # ".." alone should fall back to the default fallback.
        assert safe_filename("..") == "file"
        assert safe_filename("../") == "file"

    def test_drops_null_bytes_and_controls(self):
        assert "\x00" not in safe_filename("a\x00b.pdf")

    def test_preserves_common_characters(self):
        assert safe_filename("Scan 2024-01-02.pdf") == "Scan 2024-01-02.pdf"

    def test_reserved_windows_name_prefixed(self):
        name = safe_filename("CON.pdf")
        assert name.lower().startswith("_")

    def test_empty_falls_back(self):
        assert safe_filename("") == "file"
        assert safe_filename("   ") == "file"

    def test_long_name_truncated(self):
        huge = "a" * 500 + ".pdf"
        result = safe_filename(huge)
        assert len(result) <= 220
        assert result.endswith(".pdf")


class TestSafeVaultJoin:
    def test_happy_path(self, tmp_path: Path):
        out = safe_vault_join(tmp_path, "patients", "alice", "file.pdf")
        assert out == (tmp_path / "patients" / "alice" / "file.pdf").resolve()

    def test_rejects_parent_traversal(self, tmp_path: Path):
        with pytest.raises(UnsafePathError):
            safe_vault_join(tmp_path, "..", "outside")

    def test_rejects_absolute_component(self, tmp_path: Path):
        with pytest.raises(UnsafePathError):
            safe_vault_join(tmp_path, "/etc/passwd")

    def test_rejects_nul_byte(self, tmp_path: Path):
        with pytest.raises(UnsafePathError):
            safe_vault_join(tmp_path, "bad\x00name")

    def test_rejects_symlink_escape(self, tmp_path: Path):
        # Build a symlink inside the vault that points outside.
        (tmp_path / "vault").mkdir()
        outside = tmp_path / "outside"
        outside.mkdir()
        link = tmp_path / "vault" / "escape"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            pytest.skip("symlinks not supported on this platform")
        with pytest.raises(UnsafePathError):
            safe_vault_join(tmp_path / "vault", "escape", "file.txt")


def test_is_within(tmp_path: Path):
    inside = tmp_path / "a" / "b"
    outside = tmp_path.parent / "elsewhere"
    assert is_within(tmp_path, inside)
    assert not is_within(tmp_path, outside)
