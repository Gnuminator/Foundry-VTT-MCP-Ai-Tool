"""Listen back: transcribe every new sentence with Whisper and compare it with the script.

The voices sometimes repeat a word, drop half a sentence or mumble. Whisper (the project's own
transcriber image, ``fvtt-transcriber``, on the GPU) hears each clip, and a clip whose text is too
far from the script, or whose length does not fit the text, is taken again with another seed.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unicodedata
from dataclasses import dataclass
from pathlib import Path

IMAGE = "fvtt-transcriber:latest"
CACHE_VOLUME = "fvtt-voice-hf-cache"
MAX_CER = 0.20  # character error rate over the text without spaces
# Speaking rate bounds, characters per second of speech (spaces and punctuation included).
MIN_CPS, MAX_CPS = 6.0, 28.0


@dataclass
class Verdict:
    ok: bool
    cer: float | None
    heard: str | None
    reason: str  # empty when ok

    def to_json(self) -> dict[str, object]:
        return {"ok": self.ok, "cer": self.cer, "heard": self.heard, "reason": self.reason}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[-‐-–/]", " ", text)
    text = re.sub(r"[^\w\s]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _levenshtein(a: list[str] | str, b: list[str] | str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def cer(expected: str, heard: str) -> float:
    """Character error rate with spaces removed, so split or joined compounds cost nothing."""
    ref = normalize(expected).replace(" ", "")
    hyp = normalize(heard).replace(" ", "")
    if not ref:
        return 0.0 if not hyp else 1.0
    return _levenshtein(ref, hyp) / len(ref)


def wer(expected: str, heard: str) -> float:
    ref, hyp = normalize(expected).split(), normalize(heard).split()
    if not ref:
        return 0.0 if not hyp else 1.0
    return _levenshtein(ref, hyp) / len(ref)


def length_problem(text: str, seconds: float) -> str:
    chars = len(text)
    if seconds <= 0:
        return "no audio"
    rate = chars / seconds
    if rate < MIN_CPS and seconds > 2.0:
        return f"too long for its text ({seconds:.1f} s for {chars} characters)"
    if rate > MAX_CPS:
        return f"too short for its text ({seconds:.1f} s for {chars} characters)"
    return ""


def judge(spoken: str, shown: str, heard: str | None, seconds: float, max_cer: float = MAX_CER) -> Verdict:
    problem = length_problem(spoken, seconds)
    if heard is None:
        return Verdict(not problem, None, None, problem)
    score = min(cer(spoken, heard), cer(shown, heard))
    if score > max_cer:
        return Verdict(False, round(score, 3), heard, f"heard differs from the script (CER {score:.0%})")
    return Verdict(not problem, round(score, 3), heard, problem)


def whisper_available() -> str:
    """Empty string when the check can run, else the reason it cannot."""
    if not shutil.which("docker"):
        return "Docker is not installed"
    try:
        out = subprocess.run(
            ["docker", "image", "inspect", IMAGE, "--format", "{{.Id}}"],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"Docker did not answer ({e})"
    if out.returncode != 0:
        if "daemon" in (out.stderr or "").lower():
            return "Docker Desktop is not running"
        return f"the image {IMAGE} is missing (build it: pwsh scripts/voice-stack.ps1 up transcribe)"
    return ""


def transcribe_folder(folder: Path, lang: str) -> dict[str, str]:
    """Run the transcriber image on every .wav in ``folder``; returns {file stem: text}."""
    cmd = [
        "docker", "run", "--rm", "--gpus", "all",
        "-v", f"{folder.resolve()}:/session",
        "-v", f"{CACHE_VOLUME}:/cache",
        IMAGE, "/session", "--out", "/session/transcripts", "--language", lang, "--force",
    ]
    done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if done.returncode != 0:
        tail = "\n".join((done.stderr or done.stdout or "").splitlines()[-15:])
        raise RuntimeError(f"the transcriber failed ({done.returncode}):\n{tail}")
    heard: dict[str, str] = {}
    for path in sorted((folder / "transcripts" / "json").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        heard[path.stem] = " ".join(s.get("text", "").strip() for s in data.get("segments", [])).strip()
    return heard
