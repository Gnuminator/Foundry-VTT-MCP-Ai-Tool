"""Run the writing step for one session folder.

Per scene: one Claude call, checked by ``validate``. A failed check is retried once; then the
scene is split in two halves and each half is tried once more; a half that still fails keeps
its raw text. Each finished scene is saved to ``notes/.work/`` right away, so a usage limit or
a crash only pauses the run: the next run picks up where it stopped.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .claude_runner import AuthError, ClaudeError, Runner, UsageLimitError
from .layers import (
    DEPTH_SCHEMA,
    check_depth,
    depth_prompt,
    prompt_context,
    repair_depth,
    scene_key,
)
from .model import Line, Roster, Scene, apply_speakers, load_roster, load_timeline
from .prompts import SCENE_SCHEMA, SESSION_SCHEMA, roster_block, scene_prompt, session_prompt
from .scenes import split_scenes
from .validate import check_lines, combine, raw_fallback, repair

MIN_SPLIT_LINES = 6
# A scene that fell back to raw text is tried again on the next runs (a sleeping PC or a dropped
# network makes every call fail). After this many runs the raw scene is accepted and cached.
MAX_FALLBACK_RUNS = 3


@dataclass(slots=True)
class Options:
    scene_model: str = "sonnet"
    session_model: str = "sonnet"
    scene_effort: str = "medium"  # low missed name fixes from the list (trial 2026-09-30)
    session_effort: str = "medium"  # the summary and the spoiler-safe recap need judgement
    scene_gap: float = 90.0
    only_scene: int | None = None
    workers: int = 3  # scenes written at the same time
    # A raw scene counts as one more failed run only if the last count is older than this, so
    # three quick passes during one outage do not accept hollow scenes (tests set 0).
    fallback_gap_s: float = 1800.0
    # The three Danish layers (I-066): also write raw, in-depth notes per scene and an index.
    layers: bool = False
    depth_model: str = "sonnet"
    depth_effort: str = "medium"


@dataclass(slots=True)
class RunResult:
    scenes: int
    fallbacks: int
    paused: str | None = None  # the usage-limit or login message when the run had to stop
    login_needed: bool = False  # the stop was a logged-out claude, not a usage limit
    pending: int = 0  # raw fallback scenes that the next run tries again
    depth_missing: int = 0  # scenes without in-depth notes yet (layers only); the next run tries
    audit: list[dict[str, Any]] = field(default_factory=list)


class Writer:
    def __init__(self, session: Path, runner: Runner, options: Options | None = None) -> None:
        self.session = session
        self.runner = runner
        self.opts = options or Options()
        self.notes_dir = session / "notes"
        self.work = self.notes_dir / ".work"
        self.audit: list[dict[str, Any]] = []
        self.session_pause: str | None = None  # the limit or login message from the summary call
        self.login_needed = False  # a pause came from a logged-out claude, not a usage limit

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

        done: dict[int, dict[str, Any]] = {}
        todo: list[Scene] = []
        for scene in scenes:
            if self.opts.only_scene is not None and scene.index != self.opts.only_scene:
                continue
            cached = self.work / f"scene-{scene.index:03d}.json"
            if cached.exists():
                data = json.loads(cached.read_text(encoding="utf-8"))
                # same timeline, same split; a raw fallback counts only once it has been accepted
                # (an older run cached raw scenes as done, so they are tried again here)
                raw = bool(data["notes"].get("fallback"))
                if data.get("ids") == scene.ids and (
                    not raw or self._fallback_tries(scene) >= MAX_FALLBACK_RUNS
                ):
                    done[scene.index] = data["notes"]
                    continue
            todo.append(scene)

        # Several scenes at once; after a usage limit no new scene starts, the ones already
        # running finish, and every finished scene is saved on its own.
        paused: list[str] = []
        retry: list[int] = []
        lock = threading.Lock()

        def work(scene: Scene) -> None:
            if paused:
                return
            try:
                result = self._scene_notes(scene, roster)
            except UsageLimitError as exc:
                with lock:
                    paused.append(str(exc))
                    self.login_needed = self.login_needed or isinstance(exc, AuthError)
                self._log("paused", scene=scene.index, reason=str(exc))
                return
            result["index"] = scene.index
            result["start"] = scene.start
            result["end"] = scene.end
            if result.get("fallback") and not self._accept_fallback(scene):
                # Not cached: the next run asks Claude about this scene again.
                with lock:
                    done[scene.index] = result
                    retry.append(scene.index)
                return
            (self.work / f"scene-{scene.index:03d}.json").write_text(
                json.dumps({"ids": scene.ids, "notes": result}, ensure_ascii=False),
                encoding="utf-8",
            )
            with lock:
                done[scene.index] = result

        with ThreadPoolExecutor(max_workers=max(1, self.opts.workers)) as pool:
            list(pool.map(work, todo))
        notes = [done[i] for i in sorted(done)]
        paused_reason = paused[0] if paused else None

        session_notes: dict[str, Any] | None = None
        complete = paused_reason is None and len(notes) == len(scenes) and not retry
        if complete:
            session_notes = self._session_notes(notes, roster)
            if session_notes is None:
                paused_reason = self.session_pause
        depth: dict[int, dict[str, Any]] | None = None
        depth_missing = 0
        if self.opts.layers:
            depth = {}
            if complete and session_notes is not None:
                depth, depth_missing, depth_pause = self._depth_notes(notes, roster, lines)
                paused_reason = paused_reason or depth_pause
            else:
                depth_missing = sum(1 for n in notes if not n.get("fallback"))
        # Written even when the session summary is missing: the scene notes are useful alone.
        write_outputs(self.notes_dir, lines, roster, notes, session_notes, depth)
        self._flush_audit()
        return RunResult(
            scenes=len(notes),
            fallbacks=sum(1 for n in notes if n.get("fallback")),
            paused=paused_reason,
            login_needed=self.login_needed,
            pending=len(retry),
            depth_missing=depth_missing,
            audit=self.audit,
        )

    # --- in-depth layer ------------------------------------------------------------------------

    def _depth_notes(
        self, notes: list[dict[str, Any]], roster: Roster, lines: list[Line]
    ) -> tuple[dict[int, dict[str, Any]], int, str | None]:
        """One call per scene; returns (depth by scene index, scenes still missing, pause text)."""
        starts = {ln.id: ln.start for ln in lines}
        who = prompt_context(lines)
        block = roster_block(roster)
        done: dict[int, dict[str, Any]] = {}
        todo: list[dict[str, Any]] = []
        for scene in notes:
            if scene.get("fallback"):
                continue
            cached = self.work / f"depth-{scene['index']:03d}.json"
            try:
                data = json.loads(cached.read_text(encoding="utf-8"))
                if data.get("key") == scene_key(scene) and isinstance(data["notes"], dict):
                    done[scene["index"]] = data["notes"]
                    continue
            except (ValueError, KeyError, OSError):
                pass  # missing, partial or old: written again
            todo.append(scene)
        paused: list[str] = []
        lock = threading.Lock()

        def work(scene: dict[str, Any]) -> None:
            if paused:
                return
            started = time.monotonic()
            hint = ""
            for _attempt in range(2):
                try:
                    result = self.runner(
                        depth_prompt(scene, block, starts, who) + hint,
                        DEPTH_SCHEMA,
                        self.opts.depth_model,
                        self.opts.depth_effort,
                    )
                except UsageLimitError as exc:
                    with lock:
                        paused.append(str(exc))
                        self.login_needed = self.login_needed or isinstance(exc, AuthError)
                    self._log("paused", scene=scene["index"], reason=str(exc), layer="depth")
                    return
                except ClaudeError as exc:
                    self._log("depth_error", scene=scene["index"], error=str(exc))
                    continue
                problems = check_depth(result, scene)
                if problems:
                    self._log("depth_invalid", scene=scene["index"], problems=problems)
                    hint = (
                        "\n\nYour previous answer was rejected: "
                        + "; ".join(problems)
                        + ". Fix this."
                    )
                    continue
                fixes = repair_depth(result, scene)
                self._save_depth(scene, result)
                self._log(
                    "depth_ok",
                    scene=scene["index"],
                    beats=len(result["beats"]),
                    seconds=round(time.monotonic() - started, 1),
                    fixes=fixes,
                )
                with lock:
                    done[scene["index"]] = result
                return
            # Both tries failed. Like a raw scene, it is tried again on the next runs; after
            # MAX_FALLBACK_RUNS counted runs it is accepted without in-depth notes, so a scene
            # that never passes the checks cannot cost two calls every hour for ever.
            if self._count_depth_failure(scene):
                gave_up = {"beats": [], "fallback": True}
                self._save_depth(scene, gave_up)
                with lock:
                    done[scene["index"]] = gave_up

        with ThreadPoolExecutor(max_workers=max(1, self.opts.workers)) as pool:
            list(pool.map(work, todo))
        total = sum(1 for n in notes if not n.get("fallback"))
        return done, total - len(done), (paused[0] if paused else None)

    def _save_depth(self, scene: dict[str, Any], result: dict[str, Any]) -> None:
        path = self.work / f"depth-{scene['index']:03d}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"key": scene_key(scene), "notes": result}, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, path)

    def _count_depth_failure(self, scene: dict[str, Any]) -> bool:
        """Count this run for a scene whose in-depth notes failed; True once it is given up."""
        marker = self.work / f"depth-{scene['index']:03d}.fail.json"
        key = scene_key(scene)
        tries, last = 0, 0.0
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
            if data.get("key") == key:
                tries, last = int(data.get("tries", 0)), float(data.get("at", 0))
        except (ValueError, OSError):
            pass
        now = time.time()
        if tries == 0 or now - last >= self.opts.fallback_gap_s:
            tries += 1
            marker.write_text(
                json.dumps({"key": key, "tries": tries, "at": now}), encoding="utf-8"
            )
        self._log("depth_failed_run", scene=scene["index"], tries=tries)
        return tries >= MAX_FALLBACK_RUNS

    def _fallback_tries(self, scene: Scene) -> int:
        marker = self.work / f"scene-{scene.index:03d}.fallback.json"
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
            return int(data.get("tries", 0)) if data.get("ids") == scene.ids else 0
        except (ValueError, OSError):
            return 0

    def _accept_fallback(self, scene: Scene) -> bool:
        """Count this run for a raw scene; True once it has failed ``MAX_FALLBACK_RUNS`` runs."""
        marker = self.work / f"scene-{scene.index:03d}.fallback.json"
        tries = self._fallback_tries(scene)
        now = time.time()
        last = 0.0
        try:
            last = float(json.loads(marker.read_text(encoding="utf-8")).get("at", 0))
        except (ValueError, OSError):
            pass
        if tries == 0 or now - last >= self.opts.fallback_gap_s:
            tries += 1
            marker.write_text(
                json.dumps({"ids": scene.ids, "tries": tries, "at": now}), encoding="utf-8"
            )
        self._log("scene_fallback_run", scene=scene.index, tries=tries)
        return tries >= MAX_FALLBACK_RUNS

    def _session_notes(self, notes: list[dict[str, Any]], roster: Roster) -> dict[str, Any] | None:
        cached = self.work / "session.json"
        key = [n["index"] for n in notes]
        # The summary is about the scene notes: a scene rewritten since (a raw one that now works)
        # must not keep the old summary, so the cache also holds a digest of the notes it was for.
        digest = hashlib.sha256(
            json.dumps(notes, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        if cached.exists():
            data = json.loads(cached.read_text(encoding="utf-8"))
            if data.get("scenes") == key and data.get("digest") == digest:
                return data["notes"]
        out: dict[str, Any] | None = None
        for _attempt in range(2):  # seen once: error_max_structured_output_retries on a test clip
            try:
                out = self.runner(
                    session_prompt(notes, roster),
                    SESSION_SCHEMA,
                    self.opts.session_model,
                    self.opts.session_effort,
                )
                break
            except UsageLimitError as exc:
                self._log("paused", scene="session", reason=str(exc))
                self.session_pause = str(exc)
                self.login_needed = self.login_needed or isinstance(exc, AuthError)
                return None
            except ClaudeError as exc:
                self._log("session_error", error=str(exc))
        if out is None:
            return None
        cached.write_text(
            json.dumps({"scenes": key, "digest": digest, "notes": out}, ensure_ascii=False),
            encoding="utf-8",
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
            "workers": self.opts.workers,
        }

    def _log(self, event: str, **data: Any) -> None:
        self.audit.append({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event, **data})

    def _flush_audit(self) -> None:
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        with (self.notes_dir / "audit.jsonl").open("a", encoding="utf-8") as fh:
            for row in self.audit:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
