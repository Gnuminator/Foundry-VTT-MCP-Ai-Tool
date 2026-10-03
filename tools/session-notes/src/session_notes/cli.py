"""``session-notes run <session>``: write the notes for one session folder.

``session-notes scenes <session>`` only shows how the session would be split (no Claude call).
``session-notes publish <session>`` hands the notes to the bridge, which puts them into Foundry.
Exit codes: 0 done, 1 error, 3 the bridge cannot take the notes now (publish; try again later),
75 paused by a usage limit (run the same command again later).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .claude_runner import ClaudeCli, ClaudeError
from .model import clock, load_timeline
from .publish import publish
from .retention import RETENTION_DAYS, approve, cleanup
from .run import Options, Writer
from .scenes import split_scenes

EXIT_PAUSED = 75


def sessions_root() -> Path:
    root = os.environ.get("FVTT_SESSIONS_DIR")
    return Path(root) if root else Path.home() / "Documents" / "FoundrySessions"


def resolve_session(target: str) -> Path:
    path = Path(target)
    if path.is_dir():
        return path
    candidate = sessions_root() / target
    if candidate.is_dir():
        return candidate
    raise SystemExit(f"Session not found: {target} (also looked in {sessions_root()})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="session-notes", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="write the notes (calls claude -p)")
    run.add_argument("session", help="session folder, or its name under FVTT_SESSIONS_DIR")
    run.add_argument("--scene-model", default="sonnet")
    run.add_argument("--session-model", default="sonnet")
    run.add_argument("--scene-effort", default="medium", help="low, medium, high, xhigh or max")
    run.add_argument("--session-effort", default="medium")
    run.add_argument("--scene-gap", type=float, default=90.0, help="seconds of silence per cut")
    run.add_argument("--only-scene", type=int, help="process one scene (for testing prompts)")
    run.add_argument("--workers", type=int, default=3, help="scenes written at the same time")
    show = sub.add_parser("scenes", help="show the scene split, no Claude call")
    show.add_argument("session")
    show.add_argument("--scene-gap", type=float, default=90.0)
    ok = sub.add_parser("approve", help="mark the notes approved (starts the audio retention clock)")
    ok.add_argument("session")
    ok.add_argument("--by", default="GM")
    pub = sub.add_parser(
        "publish", help="hand the notes to the bridge (Foundry journal, D-087); sync the approval"
    )
    pub.add_argument("session")
    pub.add_argument("--port", type=int, help="bridge control port (default 31414; test 31514)")
    pub.add_argument("--world", help="Foundry world id, needed while Foundry is closed")
    pub.add_argument("--restage", action="store_true", help="stage again (only while staged)")
    clean = sub.add_parser(
        "cleanup", help=f"delete audio {RETENTION_DAYS} days after approval (D-072)"
    )
    clean.add_argument("--days", type=int, default=RETENTION_DAYS)
    clean.add_argument("--yes", action="store_true", help="really delete (default: only list)")
    args = parser.parse_args(argv)

    if args.cmd == "cleanup":
        items = cleanup(sessions_root(), days=args.days, apply=args.yes)
        for item in items:
            mb = sum(f.stat().st_size for f in item.files if f.exists()) / 1e6 if not args.yes else 0
            verb = "deleted" if args.yes else f"would delete ({mb:.0f} MB)"
            print(
                f"{item.session.name}: approved {item.approved:%Y-%m-%d}, {verb} "
                f"{len(item.files)} audio file(s)"
            )
        if not items:
            print("No session has audio past its retention date.")
        elif not args.yes:
            print("Nothing deleted. Run again with --yes to delete.")
        return 0

    session = resolve_session(args.session)
    if args.cmd == "approve":
        try:
            path = approve(session, by=args.by)
        except FileNotFoundError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(f"Approved: {path}. Audio is deleted by `cleanup` after {RETENTION_DAYS} days.")
        return 0
    if args.cmd == "publish":
        try:
            outcome = publish(session, port=args.port, world=args.world, restage=args.restage)
        except (FileNotFoundError, ValueError) as exc:
            print(exc, file=sys.stderr)
            return 1
        print(outcome.message, file=sys.stderr if outcome.code == 1 else sys.stdout)
        return outcome.code
    if args.cmd == "scenes":
        lines = load_timeline(session / "timeline" / "timeline.jsonl")
        for scene in split_scenes(lines, gap=args.scene_gap):
            print(
                f"scene {scene.index}: {clock(scene.start)} to {clock(scene.end)}, "
                f"{len(scene.lines)} lines"
            )
        return 0

    try:
        runner = ClaudeCli()
    except ClaudeError as exc:
        print(exc, file=sys.stderr)
        return 1
    opts = Options(
        scene_model=args.scene_model,
        session_model=args.session_model,
        scene_effort=args.scene_effort,
        session_effort=args.session_effort,
        scene_gap=args.scene_gap,
        only_scene=args.only_scene,
        workers=args.workers,
    )
    result = Writer(session, runner, opts).run()
    tokens_in = sum(r.input_tokens for r in runner.records)
    tokens_out = sum(r.output_tokens for r in runner.records)
    print(
        f"{result.scenes} scene(s) written to {session / 'notes'}, {result.fallbacks} kept raw; "
        f"{len(runner.records)} Claude call(s), {tokens_in} tokens in, {tokens_out} out."
    )
    if result.paused:
        print(f"Paused by a usage limit: {result.paused}\nRun the same command again later.")
        return EXIT_PAUSED
    return 0


if __name__ == "__main__":
    sys.exit(main())
