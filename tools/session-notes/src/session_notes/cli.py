"""``session-notes run <session>``: write the notes for one session folder.

``session-notes scenes <session>`` only shows how the session would be split (no Claude call).
Exit codes: 0 done, 1 error, 75 paused by a usage limit (run the same command again later).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .claude_runner import ClaudeCli, ClaudeError
from .model import clock, load_timeline
from .run import Options, Writer
from .scenes import split_scenes

EXIT_PAUSED = 75


def resolve_session(target: str) -> Path:
    path = Path(target)
    if path.is_dir():
        return path
    root = os.environ.get("FVTT_SESSIONS_DIR") or str(Path.home() / "Documents" / "FoundrySessions")
    candidate = Path(root) / target
    if candidate.is_dir():
        return candidate
    raise SystemExit(f"Session not found: {target} (also looked in {root})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="session-notes", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="write the notes (calls claude -p)")
    run.add_argument("session", help="session folder, or its name under FVTT_SESSIONS_DIR")
    run.add_argument("--scene-model", default="sonnet")
    run.add_argument("--session-model", default="sonnet")
    run.add_argument("--scene-gap", type=float, default=90.0, help="seconds of silence per cut")
    run.add_argument("--only-scene", type=int, help="process one scene (for testing prompts)")
    show = sub.add_parser("scenes", help="show the scene split, no Claude call")
    show.add_argument("session")
    show.add_argument("--scene-gap", type=float, default=90.0)
    args = parser.parse_args(argv)

    session = resolve_session(args.session)
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
        scene_gap=args.scene_gap,
        only_scene=args.only_scene,
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
