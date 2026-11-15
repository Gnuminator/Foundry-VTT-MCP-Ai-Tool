from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "requirements-voice.lock.txt"
README = (ROOT / "README.md").read_text(encoding="utf-8")


def test_voice_lock_is_fully_pinned_with_cu128_torch() -> None:
    lines = [ln for ln in LOCK.read_text(encoding="utf-8").splitlines() if ln and not ln.startswith("#")]
    assert lines and all(re.fullmatch(r"[A-Za-z0-9_.\-]+==\S+", ln) for ln in lines)
    pins = {ln.split("==")[0].lower(): ln.split("==")[1] for ln in lines}
    assert pins["torch"].endswith("+cu128") and pins["torchaudio"].endswith("+cu128")
    assert "chatterbox-tts" in pins
    assert len(pins) == len(lines)


def test_readme_installs_from_the_lock_with_the_cuda_index() -> None:
    assert "requirements-voice.lock.txt" in README
    assert "https://download.pytorch.org/whl/cu128" in README
    assert "--no-deps" in README and "--extra-index-url" in README
