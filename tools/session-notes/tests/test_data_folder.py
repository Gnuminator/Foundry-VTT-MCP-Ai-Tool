"""``data_folder``: the Python copy of dataFolder() in shared/src/sessions-dir.ts, and the same rule
in ``scripts/data-folder.ps1`` (``Get-DataFolder``). Both must agree, so one table drives both."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from session_notes.cli import data_folder

PS1 = Path(__file__).resolve().parents[3] / "scripts" / "data-folder.ps1"
PWSH = shutil.which("pwsh")


def home_env(monkeypatch: pytest.MonkeyPatch, home: Path, data: Path | None) -> None:
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    if data is None:
        monkeypatch.delenv("FVTT_DATA_DIR", raising=False)
    else:
        monkeypatch.setenv("FVTT_DATA_DIR", str(data))


def test_without_setting_is_documents(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home_env(monkeypatch, tmp_path / "home", None)
    assert data_folder("FoundrySessions") == tmp_path / "home" / "Documents" / "FoundrySessions"


def test_setting_with_moved_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = tmp_path / "data"
    (data / "FoundrySessions").mkdir(parents=True)
    (tmp_path / "home" / "Documents" / "FoundrySessions").mkdir(parents=True)
    home_env(monkeypatch, tmp_path / "home", data)
    assert data_folder("FoundrySessions") == data / "FoundrySessions"


def test_setting_not_moved_yet_keeps_old_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    legacy = tmp_path / "home" / "Documents" / "FoundrySessions"
    legacy.mkdir(parents=True)
    home_env(monkeypatch, tmp_path / "home", tmp_path / "data")
    assert data_folder("FoundrySessions") == legacy


def test_setting_and_nothing_anywhere_uses_data_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home_env(monkeypatch, tmp_path / "home", tmp_path / "data")
    assert data_folder("FoundryNarration") == tmp_path / "data" / "FoundryNarration"


@pytest.mark.skipif(sys.platform != "win32" or PWSH is None, reason="Get-DataFolder needs Windows and pwsh")
@pytest.mark.parametrize("case", ["none", "moved", "not-moved", "empty"])
def test_get_datafolder_matches_python(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: str) -> None:
    home = tmp_path / "home"
    data = tmp_path / "data"
    legacy = home / "Documents" / "FoundrySessions"
    if case in ("moved", "not-moved"):
        legacy.mkdir(parents=True)
    if case == "moved":
        (data / "FoundrySessions").mkdir(parents=True)
    home_env(monkeypatch, home, None if case == "none" else data)
    got = subprocess.run(
        [PWSH, "-NoProfile", "-Command", f". '{PS1}'; Get-DataFolder 'FoundrySessions'"],
        capture_output=True,
        text=True,
        env=os.environ.copy(),
        check=True,
    ).stdout.strip()
    assert Path(got) == data_folder("FoundrySessions")
