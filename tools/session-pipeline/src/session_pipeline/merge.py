"""TASMAS-style interleave of per-speaker word streams into one speaker-labelled line list.

The approach is adapted from TASMAS (assemble.py), Copyright (c) 2024 Kadda OK, MIT License,
https://github.com/KaddaOK/TASMAS . The idea taken from it: sort the words of all speakers by start
time, keep one open sentence buffer per speaker, and let a speaker's line reach the output only when
that speaker's clause closes, so two people talking over each other do not shred each other's
sentences. The code here is our own implementation, extended with word-gap clause boundaries (the
Danish punctuation is unreliable), a force-close for long buffers, an out-of-sync re-split and
same-speaker collapsing. See the package README for the full MIT notice.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace

from session_pipeline.model import Track, Word, words_text
from session_pipeline.textutil import TERMINAL_CHARS, ends_clause


@dataclass(frozen=True, slots=True)
class MergeConfig:
    clause_gap_s: float = 0.8  # a pause longer than this closes a speaker's clause
    max_buffer_s: float = 9.0  # force-close an open buffer longer than this
    line_gap_s: float = 4.0  # same-speaker lines further apart than this stay separate
    out_of_sync_s: float = 5.0  # a line starting this much before the previous one is re-split
    resplit_gap_s: float = 0.3  # gap used for that re-split
    max_line_s: float = 30.0  # collapsing never builds a line longer than this (keeps monologues readable)
    terminal_chars: str = TERMINAL_CHARS


@dataclass(frozen=True, slots=True)
class Line:
    speaker: str
    words: tuple[Word, ...]
    echo_suspect: bool = False

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return max(w.end for w in self.words)

    @property
    def text(self) -> str:
        return words_text(self.words)


def _split_at_largest_gap(buf: list[Word]) -> int:
    """Index k such that buf[:k+1] and buf[k+1:] are the two halves (largest internal gap, latest on ties)."""
    best_k, best_gap = 0, float("-inf")
    for k in range(len(buf) - 1):
        gap = buf[k + 1].start - buf[k].end
        if gap >= best_gap:
            best_k, best_gap = k, gap
    return best_k


def interleave(tracks: Iterable[Track], cfg: MergeConfig | None = None) -> list[Line]:
    """Sort all words, buffer per speaker, emit a line when its clause closes."""
    cfg = cfg or MergeConfig()
    items = sorted(
        ((w, t.speaker) for t in tracks for w in t.words),
        key=lambda x: (x[0].start, x[1], x[0].end),
    )
    buffers: dict[str, list[Word]] = {}
    lines: list[Line] = []

    def flush(spk: str) -> None:
        buf = buffers.pop(spk, None)
        if buf:
            lines.append(Line(spk, tuple(buf)))

    for w, spk in items:
        # buffers that went quiet are closed now, oldest first, so lines leave in time order
        for other in sorted(buffers, key=lambda s: buffers[s][0].start):
            if w.start - buffers[other][-1].end > cfg.clause_gap_s:
                flush(other)
        buf = buffers.setdefault(spk, [])
        buf.append(w)
        if ends_clause(w.word, cfg.terminal_chars):
            flush(spk)
            continue
        while len(buf) > 1 and buf[-1].end - buf[0].start > cfg.max_buffer_s:
            k = _split_at_largest_gap(buf)
            lines.append(Line(spk, tuple(buf[: k + 1])))
            del buf[: k + 1]
    for spk in sorted(buffers, key=lambda s: buffers[s][0].start):
        flush(spk)
    return lines


def split_at_gaps(line: Line, gap_s: float) -> list[Line]:
    """Split a line wherever two words are more than ``gap_s`` apart (largest gap if there is none)."""
    words = line.words
    cuts = [i + 1 for i in range(len(words) - 1) if words[i + 1].start - words[i].end > gap_s]
    if not cuts and len(words) > 1:
        cuts = [_split_at_largest_gap(list(words)) + 1]
    bounds = [0, *cuts, len(words)]
    return [
        replace(line, words=words[a:b]) for a, b in zip(bounds, bounds[1:], strict=False) if b > a
    ]


def _insert_by_start(out: list[Line], line: Line) -> None:
    k = len(out)
    while k > 0 and out[k - 1].start > line.start:
        k -= 1
    out.insert(k, line)


def fix_out_of_sync(lines: list[Line], cfg: MergeConfig | None = None) -> list[Line]:
    """Re-split a line that starts more than ``out_of_sync_s`` before the previous line, then
    place its pieces by start time."""
    cfg = cfg or MergeConfig()
    out: list[Line] = []
    for line in lines:
        if out and line.start < out[-1].start - cfg.out_of_sync_s:
            for piece in split_at_gaps(line, cfg.resplit_gap_s):
                _insert_by_start(out, piece)
        else:
            out.append(line)
    return out


def collapse_adjacent(lines: list[Line], cfg: MergeConfig | None = None) -> list[Line]:
    """Merge neighbouring lines of one speaker unless a pause above ``line_gap_s`` separates them."""
    cfg = cfg or MergeConfig()
    out: list[Line] = []
    for line in lines:
        if (
            out
            and out[-1].speaker == line.speaker
            and line.start - out[-1].end <= cfg.line_gap_s
            and max(line.end, out[-1].end) - out[-1].start <= cfg.max_line_s
        ):
            prev = out[-1]
            out[-1] = Line(
                prev.speaker, prev.words + line.words, prev.echo_suspect or line.echo_suspect
            )
        else:
            out.append(line)
    return out


def merge_tracks(tracks: Iterable[Track], cfg: MergeConfig | None = None) -> list[Line]:
    cfg = cfg or MergeConfig()
    return collapse_adjacent(fix_out_of_sync(interleave(tracks, cfg), cfg), cfg)
