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

from . import check, extras, npcs
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
from .prompts import SCENE_RULES, SCENE_SCHEMA, SESSION_RULES, SESSION_SCHEMA, roster_block, scene_prompt, session_prompt
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
    extras_model: str = "sonnet"  # character and worth-remembering layers (with layers)
    extras_effort: str = "medium"


@dataclass(slots=True)
class RunResult:
    scenes: int
    fallbacks: int
    paused: str | None = None  # the usage-limit or login message when the run had to stop
    login_needed: bool = False  # the stop was a logged-out claude, not a usage limit
    pending: int = 0  # raw fallback scenes that the next run tries again
    depth_missing: int = 0  # scenes without in-depth notes yet (layers only); the next run tries
    extras_missing: int = 0  # character / worth-remembering layers not written yet; next run tries
    audit: list[dict[str, Any]] = field(default_factory=list)


class Writer:
    def __init__(self, session: Path, runner: Runner, options: Options | None = None) -> None:
        self.session = session
        self.runner = runner
        self.opts = options or Options()
        self.notes_dir = session / "notes"
        self.work = self.notes_dir / ".work"
        self.audit: list[dict[str, Any]] = []
        self.pron_key = ""  # roster pronouns as text: part of every cache key
        self.rules_key = ""  # scene rules, schema and pronouns: a change reruns cached scenes
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

    @staticmethod
    def _text_key(scene: Scene, changed: set[str]) -> str:
        """Empty unless a names answer rewrote a line of this scene: then the scene is written again."""
        if not changed.intersection(scene.ids):
            return ""
        joined = "\n".join(ln.text for ln in scene.lines)
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    # --- the whole session -------------------------------------------------------------------

    def run(self) -> RunResult:
        from .render import write_outputs  # local import keeps the module graph simple

        timeline = self.session / "timeline" / "timeline.jsonl"
        if not timeline.exists():
            raise FileNotFoundError(f"No timeline at {timeline}; run the session pipeline first.")
        # Answers on the names page go into names.txt and rules.json first; the page is written again.
        report = check.sync(self.session)
        self._log("names_check", flagged=report.flagged, entries=report.entries, facts=report.facts,
                  answered=report.answered, new_answers=report.new_answers)
        lines = apply_speakers(load_timeline(timeline), self.session)
        lines, changed = check.apply_answers(self.session, lines)
        roster = load_roster(self.session, lines)
        self.pron_key = json.dumps(roster.pronouns, ensure_ascii=False, sort_keys=True)
        self.rules_key = hashlib.sha256(
            (SCENE_RULES + json.dumps(SCENE_SCHEMA, sort_keys=True) + self.pron_key).encode("utf-8")
        ).hexdigest()
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
                if data.get("ids") == scene.ids and data.get("rules") == self.rules_key and (
                    data.get("textkey", "") == self._text_key(scene, changed)
                ) and (
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
                json.dumps(
                    {
                        "ids": scene.ids,
                        "rules": self.rules_key,
                        "textkey": self._text_key(scene, changed),
                        "notes": result,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            with lock:
                done[scene.index] = result

        with ThreadPoolExecutor(max_workers=max(1, self.opts.workers)) as pool:
            list(pool.map(work, todo))
        notes = [done[i] for i in sorted(done)]
        paused_reason = paused[0] if paused else None
        renamed = npcs.canonicalize(notes)
        if renamed:
            self._log("npc_names_merged", renamed=renamed)

        session_notes: dict[str, Any] | None = None
        complete = paused_reason is None and len(notes) == len(scenes) and not retry
        if complete:
            session_notes = self._session_notes(notes, roster)
            if session_notes is None:
                paused_reason = self.session_pause
        depth: dict[int, dict[str, Any]] | None = None
        depth_missing = 0
        extra: dict[str, dict[str, Any] | None] = {}
        extras_missing = 0
        if self.opts.layers:
            depth = {}
            if complete and session_notes is not None:
                depth, depth_missing, depth_pause = self._depth_notes(notes, roster, lines)
                paused_reason = paused_reason or depth_pause
                if not paused_reason:
                    extra, extras_pause = self._extra_notes(notes, roster, lines)
                    paused_reason = extras_pause
                extras_missing = sum(1 for k in extras.LAYERS if extra.get(k) is None)
            else:
                depth_missing = sum(1 for n in notes if not n.get("fallback"))
                extras_missing = len(extras.LAYERS)
        # Written even when the session summary is missing: the scene notes are useful alone.
        write_outputs(self.notes_dir, lines, roster, notes, session_notes, depth, extra)
        self._flush_audit()
        return RunResult(
            scenes=len(notes),
            fallbacks=sum(1 for n in notes if n.get("fallback")),
            paused=paused_reason,
            login_needed=self.login_needed,
            pending=len(retry),
            depth_missing=depth_missing,
            extras_missing=extras_missing,
            audit=self.audit,
        )

    # --- character and worth-remembering layers ------------------------------------------------

    def _extra_notes(
        self, notes: list[dict[str, Any]], roster: Roster, lines: list[Line]
    ) -> tuple[dict[str, dict[str, Any] | None], str | None]:
        """One call per layer (per chunk of scenes when the session is very long).

        Returns ({layer: result or None when not written}, pause text). Finished chunks are
        cached in ``.work`` so a rerun only does what is missing."""
        known = extras.known_ids(lines)
        chunks = extras.chunk_scenes(notes)
        out: dict[str, dict[str, Any] | None] = {}
        for layer in extras.LAYERS:
            parts: list[dict[str, Any]] = []
            for n, chunk in enumerate(chunks, 1):
                got = self._extra_chunk(layer, n, len(chunks), chunk, roster, known)
                if isinstance(got, str):  # a usage limit or login pause
                    return out, got
                if got is None:
                    parts = []
                    break
                parts.append(got)
            empty = {"characters": []} if layer == "characters" else {"items": []}
            if not chunks:  # nothing but raw scenes: nothing to write about
                out[layer] = empty
            elif parts:
                merge = extras.merge_characters if layer == "characters" else extras.merge_remember
                out[layer] = merge(parts) if len(parts) > 1 else parts[0]
                self._clear_extra_failure(layer)
            elif self._count_extra_failure(layer, chunks, roster):
                # Like a scene's in-depth notes: after MAX_FALLBACK_RUNS counted runs the layer is
                # accepted as not written, so an optional GM-only layer never blocks the publish.
                out[layer] = {**empty, "fallback": True}
            else:
                out[layer] = None
        return out, None

    def _extra_fail_path(self, layer: str) -> Path:
        return self.work / f"extra-{layer}.fail.json"

    def _clear_extra_failure(self, layer: str) -> None:
        self._extra_fail_path(layer).unlink(missing_ok=True)

    def _count_extra_failure(self, layer: str, chunks: list[list[dict[str, Any]]], roster: Roster) -> bool:
        """Count this run for a failed layer; True once it has failed ``MAX_FALLBACK_RUNS`` runs."""
        marker = self._extra_fail_path(layer)
        key = hashlib.sha256(
            "".join(extras.chunk_key(layer, c, roster, len(chunks)) for c in chunks).encode()
        ).hexdigest()
        tries, last = 0, 0.0
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
            if data.get("key") == key:
                tries, last = int(data.get("tries", 0)), float(data.get("at", 0))
        except (ValueError, OSError, AttributeError, TypeError):
            pass
        now = time.time()
        if tries == 0 or now - last >= self.opts.fallback_gap_s:
            tries += 1
            marker.write_text(json.dumps({"key": key, "tries": tries, "at": now}), encoding="utf-8")
        self._log(f"{layer}_failed_run", tries=tries)
        return tries >= MAX_FALLBACK_RUNS

    def _extra_chunk(
        self,
        layer: str,
        n: int,
        total: int,
        chunk: list[dict[str, Any]],
        roster: Roster,
        known: set[str],
    ) -> dict[str, Any] | str | None:
        """A finished chunk result, the pause text (str), or None when both tries failed."""
        path = self.work / f"extra-{layer}-{n:02d}.json"
        key = extras.chunk_key(layer, chunk, roster, total)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("key") == key and isinstance(data["notes"], dict):
                return data["notes"]
        except (ValueError, KeyError, OSError, AttributeError, TypeError):
            pass
        started = time.monotonic()
        hint = ""
        is_chars = layer == "characters"
        build = extras.characters_prompt if is_chars else extras.remember_prompt
        for _attempt in range(2):
            try:
                result = self.runner(
                    build(chunk, roster, extras.part_note(n, total)) + hint,
                    extras.CHARACTERS_SCHEMA if is_chars else extras.REMEMBER_SCHEMA,
                    self.opts.extras_model,
                    self.opts.extras_effort,
                )
            except UsageLimitError as exc:
                self.login_needed = self.login_needed or isinstance(exc, AuthError)
                self._log("paused", scene=layer, reason=str(exc), layer=layer)
                return str(exc)
            except ClaudeError as exc:
                self._log(f"{layer}_error", part=n, error=str(exc))
                continue
            problems = (
                extras.check_characters(result, roster, known)
                if is_chars
                else extras.check_remember(result, known)
            )
            if problems:
                self._log(f"{layer}_invalid", part=n, problems=problems)
                hint = "\n\nYour previous answer was rejected: " + "; ".join(problems) + ". Fix this."
                continue
            fixes = extras.repair(result, known)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"key": key, "notes": result}, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
            self._log(f"{layer}_ok", part=n, seconds=round(time.monotonic() - started, 1), fixes=fixes)
            return result
        return None

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
                if data.get("key") == scene_key(scene, self.pron_key) and isinstance(data["notes"], dict):
                    done[scene["index"]] = data["notes"]
                    continue
            except (ValueError, KeyError, OSError, AttributeError, TypeError):
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
            json.dumps({"key": scene_key(scene, self.pron_key), "notes": result}, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, path)

    def _count_depth_failure(self, scene: dict[str, Any]) -> bool:
        """Count this run for a scene whose in-depth notes failed; True once it is given up."""
        marker = self.work / f"depth-{scene['index']:03d}.fail.json"
        key = scene_key(scene, self.pron_key)
        tries, last = 0, 0.0
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
            if data.get("key") == key:
                tries, last = int(data.get("tries", 0)), float(data.get("at", 0))
        except (ValueError, OSError, AttributeError, TypeError):
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
            (
                json.dumps(notes, ensure_ascii=False, sort_keys=True)
                + SESSION_RULES
                + self.pron_key
            ).encode("utf-8")
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
