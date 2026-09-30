"""Run the writing step for one session folder.

Per scene: one Claude call, checked by ``validate``. A failed check is retried once; then the
scene is split in two halves and each half is tried once more; a half that still fails keeps
its raw text. Each finished scene is saved to ``notes/.work/`` right away, so a usage limit or
a crash only pauses the run: the next run picks up where it stopped.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .claude_runner import ClaudeError, Runner, UsageLimitError
from .model import Roster, Scene, apply_speakers, load_roster, load_timeline
from .prompts import SCENE_SCHEMA, SESSION_SCHEMA, scene_prompt, session_prompt
from .scenes import split_scenes
from .validate import check_lines, combine, raw_fallback, repair

MIN_SPLIT_LINES = 6


@dataclass(slots=True)
class Options:
    scene_model: str = "sonnet"
    session_model: str = "sonnet"
    scene_effort: str = "low"  # mostly careful copying, fixing and translating
    session_effort: str = "medium"  # the summary and the spoiler-safe recap need judgement
    scene_gap: float = 90.0
    only_scene: int | None = None


@dataclass(slots=True)
class RunResult:
    scenes: int
    fallbacks: int
    paused: str | None = None  # the usage-limit message when the run had to stop
    audit: list[dict[str, Any]] = field(default_factory=list)


class Writer:
    def __init__(self, session: Path, runner: Runner, options: Options | None = None) -> None:
        self.session = session
        self.runner = runner
        self.opts = options or Options()
        self.notes_dir = session / "notes"
        self.work = self.notes_dir / ".work"
        self.audit: list[dict[str, Any]] = []

    # --- one scene ---------------------------------------------------------------------------

    def _call_scene(self, scene: Scene, roster: Roster) -> dict[str, Any] | None:
        """One call plus checks; ``None`` when the output fails the hard check."""
        started = time.monotonic()
        try:
            result = self.runner(
                scene_prompt(scene, roster),
                SCENE_SCHEMA,
                self.opts.scene_model,
                self.opts.scene_effort,
            )
        except UsageLimitError:
            raise
        except ClaudeError as exc:
            self._log("scene_error", scene=scene.index, lines=len(scene.lines), error=str(exc))
            return None
        problems = check_lines(result, scene)
        if problems:
            self._log("scene_invalid", scene=scene.index, lines=len(scene.lines), problems=problems)
            return None
        fixes = repair(result, scene)
        self._log(
            "scene_ok",
            scene=scene.index,
            lines=len(scene.lines),
            seconds=round(time.monotonic() - started, 1),
            fixes=fixes,
        )
        return result

    def _scene_notes(self, scene: Scene, roster: Roster, depth: int = 0) -> dict[str, Any]:
        for _attempt in range(2 if depth == 0 else 1):
            result = self._call_scene(scene, roster)
            if result is not None:
                return result
        if depth == 0 and len(scene.lines) >= MIN_SPLIT_LINES:
            mid = len(scene.lines) // 2
            halves = [
                Scene(index=scene.index, lines=scene.lines[:mid]),
                Scene(index=scene.index, lines=scene.lines[mid:]),
            ]
            self._log("scene_split", scene=scene.index)
            return combine([self._scene_notes(h, roster, depth + 1) for h in halves])
        self._log("scene_fallback", scene=scene.index, lines=len(scene.lines))
        return raw_fallback(scene)

    # --- the whole session -------------------------------------------------------------------

    def run(self) -> RunResult:
        from .render import write_outputs  # local import keeps the module graph simple

        timeline = self.session / "timeline" / "timeline.jsonl"
        if not timeline.exists():
            raise FileNotFoundError(f"No timeline at {timeline}; run the session pipeline first.")
        lines = apply_speakers(load_timeline(timeline), self.session)
        roster = load_roster(self.session, lines)
        scenes = split_scenes(lines, gap=self.opts.scene_gap)
        self.work.mkdir(parents=True, exist_ok=True)
        self._log("start", lines=len(lines), scenes=len(scenes), options=self._opts_dict())

        notes: list[dict[str, Any]] = []
        paused: str | None = None
        for scene in scenes:
            if self.opts.only_scene is not None and scene.index != self.opts.only_scene:
                continue
            cached = self.work / f"scene-{scene.index:03d}.json"
            if cached.exists():
                data = json.loads(cached.read_text(encoding="utf-8"))
                if data.get("ids") == scene.ids:  # same timeline, same split
                    notes.append(data["notes"])
                    continue
            try:
                result = self._scene_notes(scene, roster)
            except UsageLimitError as exc:
                paused = str(exc)
                self._log("paused", scene=scene.index, reason=paused)
                break
            result["index"] = scene.index
            result["start"] = scene.start
            result["end"] = scene.end
            cached.write_text(
                json.dumps({"ids": scene.ids, "notes": result}, ensure_ascii=False),
                encoding="utf-8",
            )
            notes.append(result)

        session_notes: dict[str, Any] | None = None
        complete = paused is None and self.opts.only_scene is None
        if complete:
            session_notes = self._session_notes(notes, roster)
        # Written even when the session summary is missing: the scene notes are useful alone.
        write_outputs(self.notes_dir, lines, roster, notes, session_notes)
        self._flush_audit()
        return RunResult(
            scenes=len(notes),
            fallbacks=sum(1 for n in notes if n.get("fallback")),
            paused=paused,
            audit=self.audit,
        )

    def _session_notes(self, notes: list[dict[str, Any]], roster: Roster) -> dict[str, Any] | None:
        cached = self.work / "session.json"
        key = [n["index"] for n in notes]
        if cached.exists():
            data = json.loads(cached.read_text(encoding="utf-8"))
            if data.get("scenes") == key:
                return data["notes"]
        try:
            out = self.runner(
                session_prompt(notes, roster),
                SESSION_SCHEMA,
                self.opts.session_model,
                self.opts.session_effort,
            )
        except UsageLimitError as exc:
            self._log("paused", scene="session", reason=str(exc))
            return None
        except ClaudeError as exc:
            self._log("session_error", error=str(exc))
            return None
        cached.write_text(
            json.dumps({"scenes": key, "notes": out}, ensure_ascii=False), encoding="utf-8"
        )
        self._log("session_ok")
        return out

    # --- audit -------------------------------------------------------------------------------

    def _opts_dict(self) -> dict[str, Any]:
        return {
            "scene_model": self.opts.scene_model,
            "session_model": self.opts.session_model,
            "scene_effort": self.opts.scene_effort,
            "session_effort": self.opts.session_effort,
            "scene_gap": self.opts.scene_gap,
            "only_scene": self.opts.only_scene,
        }

    def _log(self, event: str, **data: Any) -> None:
        self.audit.append({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event, **data})

    def _flush_audit(self) -> None:
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        with (self.notes_dir / "audit.jsonl").open("a", encoding="utf-8") as fh:
            for row in self.audit:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
