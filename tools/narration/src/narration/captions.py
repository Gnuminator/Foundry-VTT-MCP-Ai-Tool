"""Captions (SRT and WebVTT) from sentence timings.

The voice timing is known exactly (we made the audio), so no speech recognition is needed. A long
sentence is cut into several cues at commas or spaces, with the time shared by character count.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass

LINE_CHARS = 42
CUE_CHARS = 84  # two lines


@dataclass
class Cue:
    start: float
    end: float
    text: str  # may hold one line break


def _split_long(text: str, limit: int = CUE_CHARS) -> list[str]:
    if len(text) <= limit:
        return [text]
    words = text.split(" ")
    parts: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > limit and current:
            parts.append(current)
            current = word
        else:
            current = candidate
            # Prefer to cut after a comma once the cue is at least half full.
            if current.endswith((",", ";", ":")) and len(current) >= limit // 2:
                parts.append(current)
                current = ""
    if current:
        parts.append(current)
    return parts


def _wrap(text: str) -> str:
    lines = textwrap.wrap(text, LINE_CHARS, break_long_words=False, break_on_hyphens=False)
    if len(lines) <= 2:
        return "\n".join(lines)
    # textwrap made three short lines; balance into two instead.
    words = text.split(" ")
    best = min(
        range(1, len(words)),
        key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))),
    )
    return " ".join(words[:best]) + "\n" + " ".join(words[best:])


def build_cues(timings: list[tuple[float, float, str]]) -> list[Cue]:
    """``timings`` is (start, end, shown text) per sentence."""
    cues: list[Cue] = []
    for start, end, text in timings:
        parts = _split_long(text)
        total = sum(len(p) for p in parts) or 1
        t = start
        for i, part in enumerate(parts):
            part_end = end if i == len(parts) - 1 else t + (end - start) * len(part) / total
            cues.append(Cue(round(t, 3), round(part_end, 3), _wrap(part)))
            t = part_end
    return cues


def _stamp(seconds: float, sep: str) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(cues: list[Cue]) -> str:
    blocks = [
        f"{i}\n{_stamp(c.start, ',')} --> {_stamp(c.end, ',')}\n{c.text}\n"
        for i, c in enumerate(cues, 1)
    ]
    return "\n".join(blocks)


def to_vtt(cues: list[Cue]) -> str:
    blocks = [f"{_stamp(c.start, '.')} --> {_stamp(c.end, '.')}\n{c.text}\n" for c in cues]
    return "WEBVTT\n\n" + "\n".join(blocks)


def youtube_chapters(chapters: list[tuple[float, str]]) -> str:
    """YouTube's description format; the first chapter must start at 0:00."""
    lines = []
    for i, (start, title) in enumerate(chapters):
        seconds = 0 if i == 0 else int(start)
        m, s = divmod(seconds, 60)
        h, m = divmod(m, 60)
        stamp = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
        lines.append(f"{stamp} {title}")
    return "\n".join(lines) + ("\n" if lines else "")
