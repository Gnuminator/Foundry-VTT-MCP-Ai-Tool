"""``data_folder`` and ``out_root``: ``FVTT_DATA_DIR`` wins once the folder was moved there."""

from __future__ import annotations

from pathlib import Path

import pytest

from narration.cli import data_folder, out_root


def set_env(monkeypatch: pytest.MonkeyPatch, home: Path, data: Path | None) -> None:
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("NARRATION_OUT_DIR", raising=False)
    if data is None:
        monkeypatch.delenv("FVTT_DATA_DIR", raising=False)
    else:
        monkeypatch.setenv("FVTT_DATA_DIR", str(data))


def test_without_setting_is_documents(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, tmp_path / "home", None)
    assert out_root() == tmp_path / "home" / "Documents" / "FoundryNarration"


def test_moved_folder_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "data" / "FoundryNarration").mkdir(parents=True)
    (tmp_path / "home" / "Documents" / "FoundryNarration").mkdir(parents=True)
    set_env(monkeypatch, tmp_path / "home", tmp_path / "data")
    assert out_root() == tmp_path / "data" / "FoundryNarration"


def test_not_moved_yet_keeps_old_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    legacy = tmp_path / "home" / "Documents" / "FoundryNarration"
    legacy.mkdir(parents=True)
    set_env(monkeypatch, tmp_path / "home", tmp_path / "data")
    assert data_folder("FoundryNarration") == legacy


def test_out_dir_setting_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, tmp_path / "home", tmp_path / "data")
    monkeypatch.setenv("NARRATION_OUT_DIR", str(tmp_path / "x"))
    assert out_root() == tmp_path / "x"
