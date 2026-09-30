"""Command line: ``python -m session_pipeline merge <folder> --out <dir> ...``."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from session_pipeline.echo import levels_from_tracks
from session_pipeline.filters import parse_vocab
from session_pipeline.model import InputError, Track, load_track
from session_pipeline.names import NameRules, NameSuggester, ordinary_from_frequency, parse_rules
from session_pipeline.textutil import norm_tokens
from session_pipeline.timeline import SpeakerInfo, run_pipeline, write_outputs


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        raise InputError(f"{path}: {ex}") from ex


def load_speakers(path: Path | None) -> dict[str, SpeakerInfo]:
    if path is None:
        return {}
    data = _read_json(path)
    if not isinstance(data, dict):
        raise InputError(f"{path}: expected an object mapping track id to player and character")
    out: dict[str, SpeakerInfo] = {}
    for track_id, v in data.items():
        if not isinstance(v, dict):
            raise InputError(f"{path}: entry {track_id!r} must be an object")
        out[track_id] = SpeakerInfo(
            str(v.get("player", track_id)), str(v.get("character", v.get("player", track_id)))
        )
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="session_pipeline")
    sub = p.add_subparsers(dest="command", required=True)
    m = sub.add_parser("merge", help="filter, merge and name-fix per-speaker transcription JSON")
    m.add_argument("folder", type=Path, help="folder with one transcription JSON per speaker")
    m.add_argument("--out", type=Path, required=True, help="output folder")
    m.add_argument("--speakers", type=Path, help="JSON: track id -> {player, character}")
    m.add_argument("--vocab", type=Path, help="vocabulary file (commas or lines) for the recitation filter")
    m.add_argument("--names", type=Path, help="known names for suggestions (default: the vocabulary)")
    m.add_argument("--rules", type=Path, help="JSON: correct spelling -> [wrong spellings]")
    m.add_argument("--ordinary-words", type=Path, help="file of ordinary words the suggester must ignore")
    m.add_argument(
        "--ordinary-min-count",
        type=int,
        default=3,
        help="words this frequent in the session also count as ordinary (0 disables, default 3)",
    )
    m.add_argument("--levels", type=Path, help="JSON: track id -> RMS level in dB (enables echo dropping)")
    m.add_argument("--glob", default="*.json", help="which files in the folder to read (default *.json)")
    return p


def _read_terms(path: Path | None) -> list[str]:
    if path is None:
        return []
    try:
        return parse_vocab(path.read_text(encoding="utf-8"))
    except OSError as ex:
        raise InputError(f"{path}: {ex}") from ex


def run_merge(args: argparse.Namespace) -> int:
    files = sorted(args.folder.glob(args.glob))
    if not files:
        raise InputError(f"no files match {args.glob!r} in {args.folder}")
    tracks: list[Track] = [load_track(f) for f in files]
    vocab = _read_terms(args.vocab)
    names = _read_terms(args.names) or vocab
    rules: NameRules | None = parse_rules(_read_json(args.rules)) if args.rules else None
    ordinary: set[str] = set()
    if args.ordinary_words:
        ordinary |= {t for w in _read_terms(args.ordinary_words) for t in norm_tokens(w)}
    if args.ordinary_min_count > 0:
        ordinary |= ordinary_from_frequency(
            (s.text for t in tracks for s in t.segments), args.ordinary_min_count
        )
    suggester = NameSuggester(names, ordinary) if names else None
    levels = levels_from_tracks({k: float(v) for k, v in _read_json(args.levels).items()}) if args.levels else None

    result = run_pipeline(
        tracks, load_speakers(args.speakers), vocab, rules, suggester, levels
    )
    write_outputs(result, args.out)

    reasons = Counter(d.reason for d in result.dropped)
    print(f"tracks: {', '.join(t.speaker for t in tracks)}")
    print(f"timeline lines: {len(result.entries)}")
    print("dropped: " + (", ".join(f"{k} {v}" for k, v in sorted(reasons.items())) or "nothing"))
    print(f"low-confidence words: {len(result.low_confidence)}")
    print(f"name fixes applied: {len(result.fixes)}, suggestions: {len(result.suggestions)}")
    print(f"written to {args.out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "merge":
            return run_merge(args)
    except InputError as ex:
        print(f"error: {ex}", file=sys.stderr)
        return 2
    return 1
