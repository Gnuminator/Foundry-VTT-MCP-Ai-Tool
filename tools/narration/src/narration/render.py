"""Turn a parsed script into the narration: voice each sentence (cached), check it, join, write.

Every sentence clip is cached under a key made from the voice, its settings and the spoken text,
plus a take number. Editing one sentence therefore re-voices only that sentence, and a new take
of one sentence (``retake``) leaves the rest alone. ``takes.json`` in the output folder remembers
which take each sentence uses and how every tried take scored in the check.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from . import audio
from .captions import build_cues, to_srt, to_vtt, youtube_chapters
from .check import Verdict, judge
from .script import Script, Sentence
from .voices import Engine, Voice

Transcriber = Callable[[Path, str], dict[str, str]]
Log = Callable[[str], None]

# Bump when trim or tempo processing changes: clips are processed again from the raw voice
# output in the cache, without the GPU.
PROC = 2


@dataclass
class Result:
    master: Path
    duration: float
    sentences: int
    voiced: int  # clips made in this run
    checked: int
    retaken: int
    flagged: list[dict[str, Any]] = field(default_factory=list)  # failed the check, best take kept
    check_skipped: str = ""
    files: list[Path] = field(default_factory=list)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class _Item:
    sentence: Sentence
    base: str
    entry: dict[str, Any]

    @property
    def take(self) -> int:
        return int(self.entry["take"])

    def clip_key(self, take: int | None = None) -> str:
        return _sha(f"{self.base}:{self.take if take is None else take}")[:20]

    def seed(self, take: int | None = None) -> int:
        return int(self.base[:8], 16) + 1000 * (self.take if take is None else take)


class Renderer:
    def __init__(
        self,
        script: Script,
        voice: Voice,
        out_dir: Path,
        engine_factory: Callable[[], Engine],
        transcriber: Transcriber | None = None,
        retakes: int = 2,
        log: Log = print,
    ) -> None:
        self.script = script
        self.voice = voice
        self.out = out_dir
        self.cache = out_dir / ".cache"
        self._engine_factory = engine_factory
        self._engine: Engine | None = None
        self.transcriber = transcriber
        self.retakes = retakes
        self.log = log
        self.state_path = out_dir / "takes.json"
        self.state: dict[str, Any] = self._load_state()
        voice_id = voice.cache_id()
        self.items = []
        for s in script.sentences:
            base = _sha(voice_id + "\n" + s.spoken)
            entry = self.state.setdefault(base, {"take": 0, "tried": {}, "auto": 0, "pinned": False})
            entry["text"] = s.spoken
            self.items.append(_Item(s, base, entry))

    # -- state and cache -------------------------------------------------------------------

    def _load_state(self) -> dict[str, Any]:
        if self.state_path.is_file():
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            return dict(data.get("sentences", {}))
        return {}

    def _save_state(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        payload = {"script": self.script.name, "voice": self.voice.name, "sentences": self.state}
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.state_path)

    def _clip_path(self, item: _Item, take: int | None = None) -> Path:
        return self.cache / f"{item.clip_key(take)}.wav"

    def _raw_path(self, item: _Item, take: int | None = None) -> Path:
        return self.cache / f"{item.clip_key(take)}.raw.wav"

    def _meta_path(self, item: _Item, take: int | None = None) -> Path:
        return self.cache / f"{item.clip_key(take)}.json"

    def _meta(self, item: _Item, take: int | None = None) -> dict[str, Any]:
        path = self._meta_path(item, take)
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}

    def _write_meta(self, item: _Item, meta: dict[str, Any], take: int | None = None) -> None:
        self._meta_path(item, take).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self.log(f"Loading the {self.voice.engine} voice model...")
            self._engine = self._engine_factory()
        return self._engine

    # -- steps -----------------------------------------------------------------------------

    def select(self, index: int, take: int | None) -> None:
        """``retake``: a new take for sentence ``index``, or pick an earlier take (pinned)."""
        item = self.items[index - 1]
        if take is None:
            tried = [int(t) for t in item.entry["tried"]] + [item.take]
            item.entry.update(take=max(tried) + 1, auto=0, pinned=False)
        else:
            if not self._clip_path(item, take).is_file():
                raise ValueError(f"sentence {index} has no take {take} (known: {self.known_takes(index)})")
            item.entry.update(take=take, pinned=True)
        self._save_state()

    def known_takes(self, index: int) -> list[int]:
        item = self.items[index - 1]
        return sorted(t for t in range(0, 100) if self._clip_path(item, t).is_file())

    def _voice_missing(self) -> int:
        todo = [
            i for i in self.items
            if not self._clip_path(i).is_file() or self._meta(i).get("proc") != PROC
        ]
        voiced = 0
        for n, item in enumerate(todo, 1):
            t0 = time.monotonic()
            raw_path = self._raw_path(item)
            self.cache.mkdir(parents=True, exist_ok=True)
            if raw_path.is_file():
                raw, sr = audio.read_wav(raw_path)  # only the processing changed: no GPU
                what = "processed again"
            else:
                raw = self.engine.generate(item.sentence.spoken, self.voice, item.seed())
                sr = self.engine.sr
                audio.write_wav16(raw_path, raw, sr)
                voiced += 1
                what = "voiced"
            wav = audio.trim(raw, sr)
            wav = audio.change_speed(wav, sr, self.voice.speed)
            audio.write_wav16(self._clip_path(item), wav, sr)
            seconds = wav.size / sr
            item.entry["tried"][str(item.take)] = None  # new audio: not checked yet
            self._write_meta(item, {
                "index": item.sentence.index, "take": item.take, "seed": item.seed(),
                "spoken": item.sentence.spoken, "seconds": round(seconds, 3), "proc": PROC,
            })
            took = time.monotonic() - t0
            self.log(f"  {what} {n}/{len(todo)}: sentence {item.sentence.index}, take {item.take}"
                     f" ({seconds:.1f} s audio in {took:.1f} s)")
        return voiced

    def _check(self, items: list[_Item]) -> None:
        assert self.transcriber is not None
        folder = self.out / ".check"
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        names = {}
        for item in items:
            name = f"s{item.sentence.index:04d}"
            shutil.copyfile(self._clip_path(item), folder / f"{name}.wav")
            names[name] = item
        self.log(f"  listening back to {len(items)} clip(s) with Whisper...")
        heard = self.transcriber(folder, self.script.lang)
        for name, item in names.items():
            meta = self._meta(item)
            verdict = judge(item.sentence.spoken, item.sentence.shown, heard.get(name),
                            float(meta.get("seconds", 0.0)))
            meta["check"] = verdict.to_json()
            self._write_meta(item, meta)
            item.entry["tried"][str(item.take)] = verdict.to_json()
        shutil.rmtree(folder, ignore_errors=True)

    def _verdict(self, item: _Item, take: int | None = None) -> Verdict | None:
        data = self._meta(item, take).get("check")
        if not data:
            return None
        return Verdict(bool(data["ok"]), data.get("cer"), data.get("heard"), data.get("reason", ""))

    def run(self, check: bool = True, check_skipped: str = "") -> Result:
        self.out.mkdir(parents=True, exist_ok=True)
        voiced = self._voice_missing()
        checked = retaken = 0
        if check and self.transcriber is not None:
            while True:
                unchecked = [i for i in self.items if self._verdict(i) is None]
                if unchecked:
                    self._check(unchecked)
                    checked += len(unchecked)
                    self._save_state()
                failing = [
                    i for i in self.items
                    if not self._verdict(i).ok  # type: ignore[union-attr]
                    and not i.entry.get("pinned") and int(i.entry.get("auto", 0)) < self.retakes
                ]
                if not failing:
                    break
                for item in failing:
                    v = self._verdict(item)
                    self.log(f"  sentence {item.sentence.index} take {item.take}: {v.reason if v else ''};"
                             " taking it again")
                    tried = [int(t) for t in item.entry["tried"]] + [item.take]
                    item.entry["take"] = max(tried) + 1
                    item.entry["auto"] = int(item.entry.get("auto", 0)) + 1
                retaken += len(failing)
                self._save_state()
                voiced += self._voice_missing()
        flagged = self._settle() if check and self.transcriber is not None else []
        self._save_state()
        result = self._assemble()
        result.voiced, result.checked, result.retaken = voiced, checked, retaken
        result.flagged = flagged
        result.check_skipped = "" if check and self.transcriber is not None else (check_skipped or "off")
        self._prune()
        return result

    def _settle(self) -> list[dict[str, Any]]:
        """Where every take failed, use the best one and report the sentence."""
        flagged = []
        for item in self.items:
            v = self._verdict(item)
            if v is None or v.ok:
                continue
            best_take, best = item.take, v
            for t in item.entry["tried"]:
                tv = self._verdict(item, int(t))
                if tv is None or not self._clip_path(item, int(t)).is_file():
                    continue
                if (tv.ok, -(tv.cer if tv.cer is not None else 1.0)) > (
                    best.ok, -(best.cer if best.cer is not None else 1.0)
                ):
                    best_take, best = int(t), tv
            item.entry["take"] = best_take
            if not best.ok:
                flagged.append({
                    "index": item.sentence.index, "take": best_take, "reason": best.reason,
                    "heard": best.heard, "spoken": item.sentence.spoken,
                })
        return flagged

    def _assemble(self) -> Result:
        sr = None
        parts: list[np.ndarray] = []
        rows: list[dict[str, Any]] = []
        t = 0.0
        clips = []
        for item in self.items:
            x, clip_sr = audio.read_wav(self._clip_path(item))
            if sr is None:
                sr = clip_sr
            elif clip_sr != sr:
                raise RuntimeError("clips have different sample rates; delete the .cache folder")
            clips.append(x)
        sr = sr or 24000
        parts.append(audio.silence(self.script.lead_in, sr))
        t = self.script.lead_in
        for item, x in zip(self.items, clips):
            start, t = t, t + x.size / sr
            meta = self._meta(item)
            rows.append({
                "index": item.sentence.index, "start": round(start, 3), "end": round(t, 3),
                "shown": item.sentence.shown, "spoken": item.sentence.spoken,
                "paragraph": item.sentence.paragraph, "heading": item.sentence.heading,
                "take": item.take, "seed": item.seed(), "check": meta.get("check"),
            })
            parts.append(x)
            gap = audio.silence(item.sentence.gap_after, sr)
            parts.append(gap)
            t += gap.size / sr
        mix = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
        mix, loudness = audio.normalize(mix, sr)
        name = self.script.name
        master = self.out / f"{name}.wav"
        audio.write_master(master, mix, sr)
        cues = build_cues([(r["start"], r["end"], r["shown"]) for r in rows])
        files = [master]
        for suffix, text in ((".srt", to_srt(cues)), (".vtt", to_vtt(cues))):
            path = self.out / f"{name}{suffix}"
            path.write_text(text, encoding="utf-8")
            files.append(path)
        by_index = {r["index"]: r["start"] for r in rows}
        chapters = [(by_index[i], title) for i, title in self.script.chapters if i in by_index]
        if chapters:
            path = self.out / f"{name}.chapters.txt"
            path.write_text(youtube_chapters(chapters), encoding="utf-8")
            files.append(path)
        timing = {
            "script": str(self.script.path), "lang": self.script.lang, "voice": self.voice.name,
            "engine": self.voice.engine, "speed": self.voice.speed, "sample_rate": audio.OUT_RATE,
            "duration": round(t, 3), "loudness_in": loudness, "loudness_out": audio.TARGET_LUFS,
            "chapters": [{"start": s, "title": title} for s, title in chapters],
            "sentences": rows,
        }
        path = self.out / f"{name}.timing.json"
        path.write_text(json.dumps(timing, ensure_ascii=False, indent=1), encoding="utf-8")
        files.append(path)
        return Result(master, round(t, 3), len(rows), 0, 0, 0, files=files)

    def _prune(self) -> None:
        """Forget sentences that left the script and delete their clips."""
        keep_bases = {i.base for i in self.items}
        for base in [b for b in self.state if b not in keep_bases]:
            del self.state[base]
        keep = set()
        for item in self.items:
            takes = {item.take, *(int(t) for t in item.entry["tried"])}
            keep |= {item.clip_key(t) for t in takes}
        if self.cache.is_dir():
            for f in self.cache.iterdir():
                if f.name.split(".", 1)[0] not in keep and f.suffix in (".wav", ".json"):
                    f.unlink()
        self._save_state()
