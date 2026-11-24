"""``voices.local``: named reference voices outside the repo, so a script says ``voice: deep``."""

from __future__ import annotations

from pathlib import Path

import pytest

from narration.voices import load_local_voices, local_voices_file, resolve_voice


def write(tmp_path: Path, text: str) -> Path:
    f = tmp_path / "voices.local"
    f.write_text(text, encoding="utf-8")
    return f


def test_no_file_means_no_local_voices(tmp_path: Path) -> None:
    assert load_local_voices(tmp_path / "missing") == {}


def test_deep_voice_resolves_with_its_speed(tmp_path: Path) -> None:
    da, en = tmp_path / "da-deep.wav", tmp_path / "en-deep.wav"
    da.write_bytes(b"x")
    en.write_bytes(b"y")
    f = write(
        tmp_path,
        f"# the settled narrator\nda.deep = {da}\nda.deep.speed = 0.76\nEN.Deep = {en}\nen.deep.speed = 0.76\n",
    )
    local = load_local_voices(f)
    v_da = resolve_voice("da", "deep", None, local)
    assert (v_da.engine, v_da.ref, v_da.speed, v_da.name) == ("roest", str(da), 0.76, "deep")
    v_en = resolve_voice("en", "Deep", None, local)
    assert (v_en.engine, v_en.ref, v_en.speed) == ("turbo", str(en), 0.76)
    # a script's own speed still wins, and the built-ins stay
    assert resolve_voice("da", "deep", 0.9, local).speed == 0.9
    assert resolve_voice("da", "mic", None, local).name == "mic"


def test_speed_defaults_like_ref(tmp_path: Path) -> None:
    clip = tmp_path / "c.wav"
    clip.write_bytes(b"x")
    local = load_local_voices(write(tmp_path, f"da.calm = {clip}\nen.calm = {clip}\n"))
    assert resolve_voice("da", "calm", None, local).speed == 1.0
    assert resolve_voice("en", "calm", None, local).speed == 0.92


def test_missing_clip_and_unknown_name_say_so(tmp_path: Path) -> None:
    local = load_local_voices(write(tmp_path, f"da.deep = {tmp_path / 'gone.wav'}\n"))
    with pytest.raises(ValueError, match="clip not found"):
        resolve_voice("da", "deep", None, local)
    with pytest.raises(ValueError, match="unknown en voice 'deep'"):
        resolve_voice("en", "deep", None, local)


def test_bad_file_never_breaks_ref_voices(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NARRATION_VOICES", str(write(tmp_path, "da.deep.speed = fast\n")))
    clip = tmp_path / "c.wav"
    clip.write_bytes(b"x")
    assert resolve_voice("da", f"ref:{clip}").engine == "roest"
    assert resolve_voice("da", None).name == "mic"
    with pytest.raises(ValueError, match="speed must be a number"):
        resolve_voice("da", "deep")


@pytest.mark.parametrize("line", ["deep = x.wav", "fr.deep = x.wav", "da.deep.pitch = 1", "da.deep"])
def test_bad_lines_are_refused(tmp_path: Path, line: str) -> None:
    with pytest.raises(ValueError, match="voices.local|expected|unknown setting"):
        load_local_voices(write(tmp_path, line + "\n"))


def test_file_location_comes_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NARRATION_VOICES", str(tmp_path / "v"))
    assert local_voices_file() == tmp_path / "v"
    monkeypatch.delenv("NARRATION_VOICES")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert local_voices_file() == tmp_path / "foundry-ai-tool" / "voices.local"
