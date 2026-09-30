"""Split a session into scenes before any AI call.

A new scene starts after a long pause (a break, a scene change at the table). Scenes that run
too long are cut at their largest internal pause, so each Claude call stays a manageable size;
very short scenes are merged into the one before them.
"""

from __future__ import annotations

from .model import Line, Scene

SCENE_GAP = 90.0  # seconds of silence that start a new scene
MAX_SCENE = 900.0  # 15 minutes
MIN_SCENE = 120.0  # shorter scenes join the previous one
MAX_LINES = 160  # also keeps one call's output well under the output limit


def _cut_long(lines: list[Line], max_seconds: float, max_lines: int) -> list[list[Line]]:
    if len(lines) < 2:
        return [lines]
    too_long = lines[-1].end - lines[0].start > max_seconds or len(lines) > max_lines
    if not too_long:
        return [lines]
    # Cut at the largest pause, ignoring the outer fifth so pieces do not get tiny.
    lo = max(1, len(lines) // 5)
    hi = min(len(lines) - 1, len(lines) - len(lines) // 5)
    if hi <= lo:
        lo, hi = 1, len(lines) - 1
    best = max(range(lo, hi + 1), key=lambda i: lines[i].start - lines[i - 1].end)
    return _cut_long(lines[:best], max_seconds, max_lines) + _cut_long(
        lines[best:], max_seconds, max_lines
    )


def split_scenes(
    lines: list[Line],
    gap: float = SCENE_GAP,
    max_seconds: float = MAX_SCENE,
    min_seconds: float = MIN_SCENE,
    max_lines: int = MAX_LINES,
) -> list[Scene]:
    if not lines:
        return []
    groups: list[list[Line]] = [[lines[0]]]
    for prev, line in zip(lines, lines[1:]):
        if line.start - prev.end >= gap:
            groups.append([])
        groups[-1].append(line)

    merged: list[list[Line]] = []
    for group in groups:
        short = group[-1].end - group[0].start < min_seconds
        if merged and short:
            merged[-1].extend(group)
        else:
            merged.append(group)
    # A short first scene joins the next one instead.
    if len(merged) > 1 and merged[0][-1].end - merged[0][0].start < min_seconds:
        merged[1] = merged[0] + merged[1]
        merged.pop(0)

    pieces = [piece for group in merged for piece in _cut_long(group, max_seconds, max_lines)]
    return [Scene(index=i + 1, lines=piece) for i, piece in enumerate(pieces)]
