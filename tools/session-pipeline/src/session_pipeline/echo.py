"""Cross-track echo filter.

When someone's voice leaks into another person's microphone, the same sentence shows up on two
tracks, the leaked copy a little later and quieter. A line is an echo when a line on another track
with near-identical text started up to ``window_s`` before it and the echo's own track is clearly
quieter. Without level information the line is kept and flagged (``echo_suspect``) instead.
"""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace

from session_pipeline.filters import Dropped
from session_pipeline.merge import Line
from session_pipeline.textutil import similarity

# (speaker, start, end) -> RMS level in dB for that stretch of that track, or None when unknown
LevelFn = Callable[[str, float, float], float | None]


@dataclass(frozen=True, slots=True)
class EchoConfig:
    similarity: float = 0.85
    window_s: float = 1.5
    min_level_diff_db: float = 6.0  # the echo must be at least this much quieter than the original
    min_words: int = 3  # very short lines ("ja", "okay") match each other by chance


def levels_from_tracks(levels: Mapping[str, float]) -> LevelFn:
    """Level function from one RMS value (dB) per track."""

    def level_of(speaker: str, start: float, end: float) -> float | None:
        return levels.get(speaker)

    return level_of


def filter_echo(
    lines: list[Line],
    cfg: EchoConfig | None = None,
    level_of: LevelFn | None = None,
) -> tuple[list[Line], list[Dropped]]:
    """Drop echo lines (levels given) or flag them (no levels). Returns kept lines and the dropped."""
    cfg = cfg or EchoConfig()
    order = sorted(range(len(lines)), key=lambda i: lines[i].start)
    starts = [lines[i].start for i in order]
    kept: list[Line] = []
    dropped: list[Dropped] = []
    for line in lines:
        if len(line.words) < cfg.min_words:
            kept.append(line)
            continue
        lo = bisect_left(starts, line.start - cfg.window_s)
        verdict = "none"
        source: Line | None = None
        for idx in order[lo:]:
            other = lines[idx]
            if other.start > line.start:
                break
            if other is line or other.speaker == line.speaker or len(other.words) < cfg.min_words:
                continue
            if similarity(line.text, other.text) < cfg.similarity:
                continue
            if level_of is None:
                verdict, source = "suspect", other
                continue
            mine = level_of(line.speaker, line.start, line.end)
            theirs = level_of(other.speaker, other.start, other.end)
            if mine is None or theirs is None:
                verdict, source = "suspect", other
            elif theirs - mine >= cfg.min_level_diff_db:
                verdict, source = "echo", other
                break
        if verdict == "echo" and source is not None:
            dropped.append(
                Dropped(
                    line.speaker,
                    line.start,
                    line.end,
                    line.text,
                    "echo",
                    f"same text on {source.speaker} at {source.start:.1f}s, louder there",
                )
            )
        elif verdict == "suspect":
            kept.append(replace(line, echo_suspect=True))
        else:
            kept.append(line)
    return kept, dropped
