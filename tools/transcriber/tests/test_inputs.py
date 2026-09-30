"""File discovery and speaker naming. Synthetic names and empty files only, no real audio."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from fvtt_transcriber.inputs import collect_inputs, parse_track_name, slug


@pytest.mark.parametrize(
    ("stem", "expected"),
    [
        ("1-anna_0", (None, "anna")),
        ("12-Bo Hansen_4", (None, "bo_hansen")),
        ("userid123__microphone__TR_AMabc", (None, "userid123")),
        ("S3__carl", ("s3", "carl")),
        ("dana", (None, "dana")),
        ("Ærø-Øl", (None, "ærø-øl")),
    ],
)
def test_parse_track_name(stem: str, expected: tuple[str | None, str]) -> None:
    assert parse_track_name(stem) == expected


def test_slug_never_empty() -> None:
    assert slug("***") == "speaker"


def _touch(folder: Path, *names: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for n in names:
        (folder / n).write_bytes(b"")


def test_folder_is_scanned_recursively_and_skips_outputs(tmp_path: Path) -> None:
    _touch(tmp_path, "1-anna_0.flac", "2-bo_0.flac", "notes.txt", "video.webm")
    _touch(tmp_path / "room" / "2026-01-01_1900", "u1__microphone__TR_1.ogg")
    _touch(tmp_path / "transcripts", "old.wav")
    tracks = collect_inputs(tmp_path, tmp_path / "scratch")
    assert sorted(t.speaker for t in tracks) == ["anna", "bo", "u1"]


def test_duplicate_speakers_get_a_suffix(tmp_path: Path) -> None:
    _touch(tmp_path, "u1__microphone__TR_1.ogg", "u1__microphone__TR_2.ogg")
    tracks = collect_inputs(tmp_path, tmp_path / "scratch")
    assert [t.speaker for t in tracks] == ["u1", "u1-2"]
    assert [t.output_stem for t in tracks] == ["u1", "u1-2"]


def test_benchmark_style_keeps_label_in_output_name(tmp_path: Path) -> None:
    _touch(tmp_path, "S3__anna.wav")
    (track,) = collect_inputs(tmp_path, tmp_path / "scratch")
    assert track.speaker == "anna" and track.output_stem == "s3__anna"


def test_craig_zip_is_extracted_flat_and_only_audio(tmp_path: Path) -> None:
    z = tmp_path / "craig.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("1-anna_0.flac", b"")
        zf.writestr("../evil/2-bo_0.flac", b"")
        zf.writestr("info.txt", "x")
        zf.writestr("raw.dat", "x")
    scratch = tmp_path / "scratch"
    tracks = collect_inputs(z, scratch)
    assert sorted(t.speaker for t in tracks) == ["anna", "bo"]
    assert all(t.path.parent == scratch for t in tracks)


def test_folder_with_one_zip_is_a_craig_download(tmp_path: Path) -> None:
    with zipfile.ZipFile(tmp_path / "craig.zip", "w") as zf:
        zf.writestr("1-anna_0.flac", b"")
    (track,) = collect_inputs(tmp_path, tmp_path / "scratch")
    assert track.speaker == "anna"


def test_empty_folder_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        collect_inputs(tmp_path, tmp_path / "scratch")
