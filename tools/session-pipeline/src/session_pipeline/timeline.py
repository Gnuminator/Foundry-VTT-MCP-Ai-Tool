"""Glue: filter, merge, echo, names, then the timeline files."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from session_pipeline.echo import EchoConfig, LevelFn, filter_echo
from session_pipeline.filters import Dropped, FilterConfig, LowConfidenceWord, VocabIndex, filter_track
from session_pipeline.merge import Line, MergeConfig, collapse_adjacent, merge_tracks
from session_pipeline.model import Track, Word
from session_pipeline.names import Fix, NameRules, NameSuggester, Suggestion, fix_case
from session_pipeline.textutil import fmt_hms


@dataclass(frozen=True, slots=True)
class SpeakerInfo:
    player: str
    character: str


@dataclass(frozen=True, slots=True)
class PipelineConfig:
    filters: FilterConfig = field(default_factory=FilterConfig)
    merge: MergeConfig = field(default_factory=MergeConfig)
    echo: EchoConfig = field(default_factory=EchoConfig)


@dataclass(frozen=True, slots=True)
class Entry:
    """One timeline line, with the speaker map applied and name rules applied to the text."""

    start: float
    end: float
    speaker: str
    player: str
    character: str
    text: str
    words: tuple[Word, ...]
    echo_suspect: bool = False

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "speaker": self.speaker,
            "player": self.player,
            "character": self.character,
            "text": self.text,
            "words": [
                {
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "word": w.text,
                    "probability": round(w.probability, 3),
                }
                for w in self.words
            ],
        }
        if self.echo_suspect:
            d["echo_suspect"] = True
        return d

    def md(self) -> str:
        return f"[{fmt_hms(self.start)}] {self.character} [{self.player}]: {self.text}"


@dataclass(slots=True)
class PipelineResult:
    entries: list[Entry] = field(default_factory=list)
    dropped: list[Dropped] = field(default_factory=list)
    low_confidence: list[LowConfidenceWord] = field(default_factory=list)
    fixes: list[dict[str, Any]] = field(default_factory=list)
    suggestions: list[dict[str, Any]] = field(default_factory=list)


def run_pipeline(
    tracks: Iterable[Track],
    speakers: Mapping[str, SpeakerInfo] | None = None,
    vocab: Iterable[str] = (),
    rules: NameRules | None = None,
    suggester: NameSuggester | None = None,
    level_of: LevelFn | None = None,
    cfg: PipelineConfig | None = None,
    auto_fix: bool = True,
) -> PipelineResult:
    cfg = cfg or PipelineConfig()
    speakers = speakers or {}
    index = VocabIndex(vocab)
    result = PipelineResult()

    filtered: list[Track] = []
    for track in tracks:
        fr = filter_track(track, cfg.filters, index)
        filtered.append(fr.track)
        result.dropped.extend(fr.dropped)
        result.low_confidence.extend(fr.low_confidence)

    lines: list[Line] = merge_tracks(filtered, cfg.merge)
    lines, echoed = filter_echo(lines, cfg.echo, level_of)
    result.dropped.extend(echoed)
    lines = collapse_adjacent(lines, cfg.merge)

    for line in lines:
        info = speakers.get(line.speaker) or SpeakerInfo(line.speaker, line.speaker)
        text = line.text
        applied: list[Fix] = []
        if rules:
            text, applied = rules.apply(text)
        auto: list[Suggestion] = []
        sugg: list[Suggestion] = []
        if suggester:
            text, auto, sugg = suggester.fix(text, apply=auto_fix)
        result.entries.append(
            Entry(line.start, line.end, line.speaker, info.player, info.character, text, line.words, line.echo_suspect)
        )
        for f in applied:
            result.fixes.append(
                {"kind": "rule", "start": round(line.start, 3), "speaker": line.speaker, **f.to_dict()}
            )
        for a in auto:
            result.fixes.append(
                {
                    "kind": "auto",
                    "start": round(line.start, 3),
                    "time": fmt_hms(line.start),
                    "speaker": line.speaker,
                    "before": a.heard,
                    "after": fix_case(a.heard, a.replacement),
                    "name": a.suggested,
                    "score": round(a.score, 3),
                }
            )
        for s in sugg:
            result.suggestions.append({"start": round(line.start, 3), "speaker": line.speaker, **s.to_dict()})

    result.dropped.sort(key=lambda d: (d.start, d.speaker))
    result.low_confidence.sort(key=lambda w: (w.start, w.speaker))
    return result


def _write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_outputs(result: PipelineResult, out_dir: str | Path) -> dict[str, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = {
        "timeline_jsonl": out / "timeline.jsonl",
        "timeline_md": out / "timeline.md",
        "low_confidence": out / "low_confidence.jsonl",
        "fixes": out / "fixes.json",
        "dropped": out / "dropped.jsonl",
    }
    _write_jsonl(paths["timeline_jsonl"], (e.to_dict() for e in result.entries))
    paths["timeline_md"].write_text(
        "".join(e.md() + "\n" for e in result.entries), encoding="utf-8", newline="\n"
    )
    _write_jsonl(paths["low_confidence"], (w.to_dict() for w in result.low_confidence))
    _write_jsonl(paths["dropped"], (d.to_dict() for d in result.dropped))
    paths["fixes"].write_text(
        json.dumps(
            {
                "applied": result.fixes,
                "suggestions": result.suggestions,
                "summary": {
                    "applied": len(result.fixes),
                    "auto": sum(1 for f in result.fixes if f.get("kind") == "auto"),
                    "suggestions": len(result.suggestions),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return paths
