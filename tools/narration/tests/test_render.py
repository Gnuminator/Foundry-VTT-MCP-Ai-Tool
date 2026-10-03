from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from narration.audio import read_wav
from narration.render import Renderer
from narration.script import parse_script
from narration.voices import Voice

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")

VOICE = Voice("da", "fake", "roest", None, 1.0, {"t": 1})
TEXT = "---\nlang: da\n---\n# Del et\n\nEn kort sætning. En anden sætning her.\n\nDen tredje.\n"


class FakeEngine:
    sr = 24000

    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def generate(self, text: str, voice: Voice, seed: int) -> np.ndarray:
        self.calls.append((text, seed))
        n = int(self.sr * len(text) / 14)  # about 14 characters a second
        t = np.arange(n) / self.sr
        tone = 0.3 * np.sin(2 * np.pi * 220 * t).astype(np.float32)
        return np.concatenate([np.zeros(2400, np.float32), tone, np.zeros(4800, np.float32)])


class FakeWhisper:
    """Hears every clip right, except the first ``bad`` hearings of the listed sentences."""

    def __init__(self, spoken: dict[int, str], bad: dict[int, int]) -> None:
        self.spoken, self.bad, self.rounds = spoken, dict(bad), 0

    def __call__(self, folder: Path, lang: str) -> dict[str, str]:
        self.rounds += 1
        out = {}
        for wav in sorted(folder.glob("*.wav")):
            index = int(wav.stem[1:])
            if self.bad.get(index, 0) > 0:
                self.bad[index] -= 1
                out[wav.stem] = "noget helt andet og forkert"
            else:
                out[wav.stem] = self.spoken[index]
        return out


def make(tmp_path: Path, text: str = TEXT, whisper: FakeWhisper | None = None,
         engine: FakeEngine | None = None, retakes: int = 2) -> tuple[Renderer, FakeEngine]:
    path = tmp_path / "demo.da.md"
    path.write_text(text, encoding="utf-8")
    script = parse_script(path)
    engine = engine or FakeEngine()
    r = Renderer(script, VOICE, tmp_path / "out", lambda: engine, whisper, retakes=retakes,
                 log=lambda _m: None)
    return r, engine


def spoken_of(r: Renderer) -> dict[int, str]:
    return {s.index: s.spoken for s in r.script.sentences}


def test_render_writes_master_captions_timing(tmp_path: Path) -> None:
    r, engine = make(tmp_path)
    res = r.run(check=False)
    assert res.voiced == 3 and len(engine.calls) == 3
    names = sorted(p.name for p in res.files)
    assert names == ["demo.da.chapters.txt", "demo.da.srt", "demo.da.timing.json", "demo.da.vtt",
                     "demo.da.wav"]
    timing = json.loads((r.out / "demo.da.timing.json").read_text(encoding="utf-8"))
    rows = timing["sentences"]
    assert rows[0]["start"] == pytest.approx(r.script.lead_in)
    for a, b in zip(rows, rows[1:]):
        assert b["start"] >= a["end"]
    assert timing["duration"] == pytest.approx(res.duration)
    assert (r.out / "demo.da.chapters.txt").read_text(encoding="utf-8") == "0:00 Del et\n"
    srt = (r.out / "demo.da.srt").read_text(encoding="utf-8")
    assert "En kort sætning." in srt


def test_cache_revoices_only_changed_sentences(tmp_path: Path) -> None:
    r, engine = make(tmp_path)
    r.run(check=False)
    r2, engine2 = make(tmp_path, TEXT.replace("Den tredje.", "Den fjerde."))
    res = r2.run(check=False)
    assert [c[0] for c in engine2.calls] == ["Den fjerde."]
    assert res.voiced == 1
    # The clip of the removed sentence is pruned; three sentences keep one clip each.
    cached = [p.name for p in (r2.out / ".cache").glob("*.wav")]
    assert len([n for n in cached if n.endswith(".raw.wav")]) == 3
    assert len([n for n in cached if not n.endswith(".raw.wav")]) == 3


def test_processing_change_reuses_raw_voice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import narration.render as render_mod

    r, _ = make(tmp_path)
    r.run(check=False)
    monkeypatch.setattr(render_mod, "PROC", render_mod.PROC + 1)
    r2, engine2 = make(tmp_path, whisper=FakeWhisper(spoken_of(r), {}))
    res = r2.run(check=True)
    assert engine2.calls == [] and res.voiced == 0
    assert res.checked == 3  # new audio is checked again


def test_failing_sentence_is_retaken_with_a_new_seed(tmp_path: Path) -> None:
    r, _ = make(tmp_path)
    whisper = FakeWhisper(spoken_of(r), {2: 1})
    r, engine = make(tmp_path, whisper=whisper)
    res = r.run(check=True)
    assert res.retaken == 1 and not res.flagged
    seeds = [seed for text, seed in engine.calls if text == r.script.sentences[1].spoken]
    assert len(seeds) == 2 and seeds[0] != seeds[1]
    state = json.loads(r.state_path.read_text(encoding="utf-8"))["sentences"]
    entry = next(e for e in state.values() if e["text"] == r.script.sentences[1].spoken)
    assert entry["take"] == 1 and set(entry["tried"]) == {"0", "1"}
    # A second run needs nothing: voiced, checked and chosen takes are remembered.
    r2, engine2 = make(tmp_path, whisper=FakeWhisper(spoken_of(r), {}))
    res2 = r2.run(check=True)
    assert engine2.calls == [] and res2.checked == 0


def test_all_takes_fail_keeps_best_and_flags(tmp_path: Path) -> None:
    r, _ = make(tmp_path)
    whisper = FakeWhisper(spoken_of(r), {3: 99})
    r, engine = make(tmp_path, whisper=whisper, retakes=2)
    res = r.run(check=True)
    assert res.retaken == 2
    assert [f["index"] for f in res.flagged] == [3]
    assert res.flagged[0]["heard"] == "noget helt andet og forkert"


def test_manual_retake_and_going_back(tmp_path: Path) -> None:
    r, _ = make(tmp_path)
    r.run(check=False)
    r, engine = make(tmp_path)
    r.select(2, None)
    r.run(check=False)
    assert len(engine.calls) == 1
    assert r.known_takes(2) == [0, 1]
    r, engine = make(tmp_path)
    r.select(2, 0)
    r.run(check=False)
    assert engine.calls == []
    assert r.items[1].take == 0 and r.items[1].entry["pinned"]
    with pytest.raises(ValueError, match="no take 7"):
        r.select(2, 7)


def test_master_is_48k_and_normalized(tmp_path: Path) -> None:
    import subprocess

    r, _ = make(tmp_path)
    res = r.run(check=False)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=sample_rate,bits_per_raw_sample,channels",
         "-of", "json", str(res.master)], capture_output=True, text=True, check=True)
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream["sample_rate"] == "48000" and stream["channels"] == 1
    clip, sr = read_wav(next((r.out / ".cache").glob("*.wav")))
    assert sr == 24000 and clip.size > 0
