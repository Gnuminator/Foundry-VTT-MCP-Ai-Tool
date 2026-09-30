"""Builders for synthetic tracks. Nothing here is real speech or campaign text."""

from __future__ import annotations

from session_pipeline.model import Segment, Track, Word


def mk_words(
    text: str,
    start: float = 0.0,
    dur: float = 0.4,
    gap: float = 0.1,
    p: float = 0.95,
    gaps: dict[int, float] | None = None,
) -> list[Word]:
    """Words for ``text``; ``gaps`` maps a word index to an extra pause placed before it."""
    out: list[Word] = []
    t = start
    for i, tok in enumerate(text.split()):
        t += (gaps or {}).get(i, 0.0)
        out.append(Word(round(t, 3), round(t + dur, 3), " " + tok, p))
        t += dur + gap
    return out


def mk_segment(
    words: list[Word],
    no_speech_prob: float = 0.05,
    compression_ratio: float = 1.2,
    avg_logprob: float = -0.2,
) -> Segment:
    return Segment(
        start=words[0].start,
        end=words[-1].end,
        text=" ".join(w.text for w in words),
        no_speech_prob=no_speech_prob,
        avg_logprob=avg_logprob,
        compression_ratio=compression_ratio,
        words=tuple(words),
    )


def mk_track(speaker: str, *segments: Segment) -> Track:
    return Track(speaker, list(segments))


def say(speaker: str, text: str, start: float = 0.0, **kw: float) -> Track:
    """A track with one segment saying ``text``."""
    return mk_track(speaker, mk_segment(mk_words(text, start), **kw))
