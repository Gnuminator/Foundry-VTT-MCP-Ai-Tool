"""``session-notes run <session>``: write the notes for one session folder.

``session-notes scenes <session>`` only shows how the session would be split (no Claude call).
``session-notes publish <session>`` hands the notes to the bridge, which puts them into Foundry.
Exit codes: 0 done, 1 error, 3 the bridge cannot take the notes now (publish; try again later),
75 paused by a usage limit or a logged-out claude (run the same command again later), 76 some scenes are still raw (run again),
77 (consent check) a speaker has no recorded yes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .claude_runner import ClaudeCli, ClaudeError
from .consent import EXIT_NO_CONSENT, check_consent, load_consent, set_consent
from .inbox import pending as inbox_pending
from .inbox import sync as inbox_sync
from .model import clock, load_timeline
from .publish import publish
from .report import send_report
from .retention import approve, cleanup
from .run import MAX_FALLBACK_RUNS, Options, Writer
from .scenes import split_scenes
from .status import write_status

EXIT_PAUSED = 75
EXIT_INCOMPLETE = 76
EXIT_SUMMARY_FAILED = 78  # the scenes are written, the session summary is not (77 is no consent)


def data_folder(name: str) -> Path:
    """`Documents\\<name>`, or `FVTT_DATA_DIR\\<name>` once the data folder is set and the folder was moved."""
    # Same rule as dataFolder() in shared/src/sessions-dir.ts and Get-DataFolder in scripts/data-folder.ps1.
    legacy = Path.home() / "Documents" / name
    data = os.environ.get("FVTT_DATA_DIR")
    if not data:
        return legacy
    moved = Path(data) / name
    return moved if moved.exists() or not legacy.exists() else legacy


def sessions_root() -> Path:
    root = os.environ.get("FVTT_SESSIONS_DIR")
    return Path(root) if root else data_folder("FoundrySessions")


def positive_days(text: str) -> int:
    """`cleanup --days`: a whole number of at least 1, so a slip like 0 cannot delete everything."""
    try:
        days = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a whole number: {text!r}") from None
    if days < 1:
        raise argparse.ArgumentTypeError(f"must be 1 or more, got {days}")
    return days


def resolve_session(target: str) -> Path:
    path = Path(target)
    if path.is_dir():
        return path
    candidate = sessions_root() / target
    if candidate.is_dir():
        return candidate
    raise SystemExit(f"Session not found: {target} (also looked in {sessions_root()})")


def run_consent(args: argparse.Namespace) -> int:
    if args.consent_cmd == "set":
        try:
            path = set_consent(sessions_root(), args.user_id, args.answer, args.name, args.date)
        except ValueError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(f"Recorded {args.answer} for {args.user_id} in {path}.")
        return 0
    if args.consent_cmd == "list":
        players = load_consent(sessions_root())
        for uid, p in sorted(players.items()):
            print(f"{uid}  {p.get('answer', '?'):3}  {p.get('date', '')}  {p.get('name', '')}")
        if not players:
            print("No consent recorded yet.")
        return 0
    session = resolve_session(args.session)
    result = check_consent(session, sessions_root())
    print(result.message)
    if result.ok:
        return 0
    if args.write_status:
        write_status(session, "waiting", f"Waiting for recording consent. {result.message}")
    return EXIT_NO_CONSENT


def run_outbox(args: argparse.Namespace) -> int:
    from . import outbox

    session = resolve_session(args.session)
    try:
        if args.outbox_cmd == "build":
            data = outbox.build(session, runner=ClaudeCli() if args.ai else None, model=args.model)
            print(f"{len(data['items'])} note(s) in {outbox.outbox_path(session)}")
        elif args.outbox_cmd == "preview":
            print(outbox.preview(session))
        elif args.outbox_cmd == "approve":
            print("Approved: " + ", ".join(outbox.approve(session, args.ids, by=args.by)))
        elif args.outbox_cmd == "obsidian":
            for path in outbox.write_obsidian(session, args.folder, args.gm_folder):
                print(f"wrote {path}")
        elif args.outbox_cmd == "foundry":
            print(json.dumps(outbox.foundry_payload(session, args.lang), ensure_ascii=False, indent=2))
        elif args.outbox_cmd == "mark-sent":
            outbox.mark_sent(session, args.id, args.medium, args.detail)
        elif args.outbox_cmd == "edit":
            item = outbox.edit(session, args.id, args.file.read_text(encoding="utf-8"))
            print(f"{item['id']} edited, back to draft ({len(item['discord'])} Discord message(s)).")
        else:
            review = json.loads(args.file.read_text(encoding="utf-8"))
            for key, what in outbox.apply_review(session, review, by=args.by).items():
                print(f"{key}: {what}")
    except (OSError, KeyError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


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
    run.add_argument(
        "--layers",
        action="store_true",
        help="also write the raw and in-depth Danish layers and an index (I-066)",
    )
    run.add_argument("--depth-model", default="sonnet")
    run.add_argument("--depth-effort", default="medium")
    show = sub.add_parser("scenes", help="show the scene split, no Claude call")
    show.add_argument("session")
    show.add_argument("--scene-gap", type=float, default=90.0)
    chk = sub.add_parser(
        "check",
        help="write the 'Names and facts to check' pages and read the answers on them (no Claude call)",
    )
    chk.add_argument("session")
    agn = sub.add_parser(
        "agenda",
        help="show the table agenda (open questions carried over); --settle or --drop marks one by hand",
    )
    agn.add_argument("session", nargs="?", help="unused; the agenda covers every session")
    agn.add_argument("--settle", metavar="ID", help="mark the item settled")
    agn.add_argument("--drop", metavar="ID", help="mark the item dropped")
    agn.add_argument("--reopen", metavar="ID", help="mark the item open again")
    camp = sub.add_parser(
        "campaign",
        help="build the campaign merge plan from the notes (calls claude -p); writes "
        "notes/campaign-merge.json for plan-campaign-merge",
    )
    camp.add_argument("session")
    camp.add_argument("--model", default="sonnet")
    camp.add_argument("--effort", default="medium", help="low, medium, high, xhigh or max")
    camp.add_argument("--label", help='the session block name on the pages (default "Session NN" from the folder)')
    camp.add_argument("--chat-log", type=Path, help="Foundry chat log (default <session>/chat-log.json)")
    camp.add_argument("--foundry-facts", type=Path, help="Foundry stats, items, level, ownership (default <session>/foundry-facts.json)")
    camp.add_argument(
        "--switch",
        choices=["on", "off"],
        default="off",
        help="the GM's 'apply additions without confirming' switch in Foundry (recorded in the plan)",
    )
    ok = sub.add_parser("approve", help="mark the notes approved (audio is kept, D-097)")
    ok.add_argument("session")
    ok.add_argument("--by", default="GM")
    pub = sub.add_parser(
        "publish", help="hand the notes to the bridge (Foundry journal, D-087); sync the approval"
    )
    pub.add_argument("session")
    pub.add_argument("--port", type=int, help="bridge control port (default 31414; test 31514)")
    pub.add_argument("--world", help="Foundry world id, needed while Foundry is closed")
    pub.add_argument("--restage", action="store_true", help="stage again (only while staged)")
    rep = sub.add_parser(
        "report",
        help="send the newest run status and the approved recap to the bridge (best effort)",
    )
    rep.add_argument("--port", type=int, help="bridge control port (as for publish)")
    rep.add_argument("--world", help="Foundry world id, needed while Foundry is closed")
    clean = sub.add_parser(
        "cleanup",
        help="manual: delete audio of sessions approved at least --days ago (audio is kept by "
        "default, D-097; nothing runs this automatically)",
    )
    clean.add_argument(
        "--days",
        type=positive_days,
        required=True,
        help="only sessions approved at least this many days ago (1 or more)",
    )
    clean.add_argument("--yes", action="store_true", help="really delete (default: only list)")
    con = sub.add_parser("consent", help="recorded yes/no of each player (D-097)")
    con_sub = con.add_subparsers(dest="consent_cmd", required=True)
    con_set = con_sub.add_parser("set", help="record a player's answer in consent.json")
    con_set.add_argument("user_id", help="Discord user id (digits)")
    con_set.add_argument("answer", choices=["yes", "no"])
    con_set.add_argument("--name", default="", help="a label for you, e.g. the display name")
    con_set.add_argument("--date", help="the day they answered (default: today)")
    con_sub.add_parser("list", help="show the recorded answers")
    con_check = con_sub.add_parser("check", help="does every speaker of a session have a yes?")
    con_check.add_argument("session")
    con_check.add_argument(
        "--write-status", action="store_true", help="when blocked, say so in notes/status.json"
    )
    ros = sub.add_parser("roster", help="roster.json: Discord user id to character, and who is GM")
    ros_sub = ros.add_subparsers(dest="roster_cmd", required=True)
    ros_check = ros_sub.add_parser("check", help="list the speakers of a session that the roster does not know")
    ros_check.add_argument("session")
    out = sub.add_parser("outbox", help="the notes that go out to players: build, preview, approve (sends nothing)")
    out_sub = out.add_subparsers(dest="outbox_cmd", required=True)
    for name, helptext in (
        ("build", "make notes/outbox/outbox.json from the finished notes (no Claude call)"),
        ("preview", "dry run: per recipient exactly what would go out"),
    ):
        out_sub.add_parser(name, help=helptext).add_argument("session")
    out_sub.choices["build"].add_argument(
        "--ai", action="store_true", help="write each player's to-dos with Claude from the Table page (subscription)"
    )
    out_sub.choices["build"].add_argument("--model", default="sonnet")
    out_ok = out_sub.add_parser("approve", help="approve notes by id (the approver's OK, per note)")
    out_ok.add_argument("session")
    out_ok.add_argument("ids", nargs="+")
    out_ok.add_argument("--by", default="Christian")
    out_ed = out_sub.add_parser("edit", help="replace a note's text from a file; it goes back to draft")
    out_ed.add_argument("session")
    out_ed.add_argument("id")
    out_ed.add_argument("file", type=Path)
    out_ob = out_sub.add_parser("obsidian", help="write approved notes as vault pages into a folder")
    out_ob.add_argument("session")
    out_ob.add_argument("folder", type=Path)
    out_ob.add_argument("--gm-folder", type=Path, default=None,
                        help="where the GM's own decisions note goes (never the players' folder); skipped without it")
    out_fd = out_sub.add_parser("foundry", help="print the approved notes as the Foundry step takes them (JSON)")
    out_fd.add_argument("session")
    out_fd.add_argument("lang", choices=["da", "en"])
    out_ms = out_sub.add_parser("mark-sent", help="record that a medium was delivered for a note")
    out_ms.add_argument("session")
    out_ms.add_argument("id")
    out_ms.add_argument("medium", choices=["foundry", "foundryPlan"])
    out_ms.add_argument("--detail", default="")
    out_rv = out_sub.add_parser("apply-review", help="apply a review page's saved answers (JSON file)")
    out_rv.add_argument("session")
    out_rv.add_argument("file", type=Path)
    out_rv.add_argument("--by", default="Christian")
    inb = sub.add_parser(
        "inbox", help="recap inbox for a cloud routine (I-132); needs FVTT_RECAP_INBOX"
    )
    inb_sub = inb.add_subparsers(dest="inbox_cmd", required=True)
    inb_sub.add_parser("sync", help="PC pass: import finished notes, export new sessions, push")
    inb_sub.add_parser("pending", help="list inbox sessions that still need notes (routine side)")
    args = parser.parse_args(argv)

    if args.cmd == "consent":
        return run_consent(args)
    if args.cmd == "roster":
        from . import roster

        result = roster.check(resolve_session(args.session), sessions_root())
        print(result.message)
        return 0 if result.ok else 1
    if args.cmd == "outbox":
        return run_outbox(args)
    if args.cmd == "agenda":
        from . import agenda

        root = sessions_root()
        try:
            for flag, status in (("settle", "settled"), ("drop", "dropped"), ("reopen", "open")):
                if getattr(args, flag):
                    agenda.set_status(root, getattr(args, flag), status)
        except ValueError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(agenda.render(agenda.load(root), "en"))
        return 0
    if args.cmd == "inbox":
        raw = os.environ.get("FVTT_RECAP_INBOX")
        if not raw or not Path(raw).is_dir():
            print("FVTT_RECAP_INBOX is not set to a folder; the recap inbox is off.")
            return 0 if args.inbox_cmd == "sync" else 1
        if args.inbox_cmd == "pending":
            for path in inbox_pending(Path(raw)):
                print(path)
            return 0
        try:
            report = inbox_sync(sessions_root(), Path(raw))
        except RuntimeError as exc:
            print(exc, file=sys.stderr)
            return 1
        print("\n".join(report.lines()))
        return 0
    if args.cmd == "report":
        print(send_report(sessions_root(), port=args.port, world=args.world))
        return 0
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
            print(f"No session approved {args.days}+ days ago has audio.")
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
        print(f"Approved: {path}. The audio is kept (D-097).")
        return 0
    if args.cmd == "publish":
        try:
            outcome = publish(session, port=args.port, world=args.world, restage=args.restage)
        except (FileNotFoundError, ValueError) as exc:
            print(exc, file=sys.stderr)
            return 1
        print(outcome.message, file=sys.stderr if outcome.code == 1 else sys.stdout)
        return outcome.code
    if args.cmd == "check":
        from . import check

        try:
            rep = check.sync(session)
        except FileNotFoundError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(
            f"{rep.entries} name(s) and {rep.facts} fact(s) to check ({rep.flagged} uncertain words "
            f"before merging); {rep.answered} answered, {rep.new_answers} new answer(s) read; "
            f"{len(rep.names_added)} name(s) added to names.txt, {rep.rules_added} rule(s) to rules.json."
        )
        for line in rep.conflicts:
            print(f"Conflict (English page used): {line}")
        print(f"Pages: {check.page_path(session, 'en')} and {check.page_path(session, 'da')}")
        return 0
    if args.cmd == "campaign":
        from . import campaign

        try:
            done = campaign.run(
                session,
                ClaudeCli(),
                model=args.model,
                effort=args.effort,
                label=args.label,
                chat=args.chat_log,
                facts=args.foundry_facts,
                switch=args.switch == "on",
            )
        except (FileNotFoundError, ClaudeError, ValueError) as exc:
            print(exc, file=sys.stderr)
            return 1
        if done.paused:
            print(f"Paused: {done.paused}\nRun the same command again later.")
            return EXIT_PAUSED
        plan = done.plan
        print(
            f"Campaign merge plan for {plan['label']}: {len(plan['entries'])} entr(ies) to merge, "
            f"{len(plan['held'])} held for a confirmed name, {len(plan['checks']['facts'])} fact(s) "
            f"to check, {len(plan['hints'])} hint(s). Plan: {session / 'notes' / campaign.PLAN_FILE}"
        )
        return 0
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
        write_status(session, "failed", f"Claude could not be started: {exc}")
        return 1
    opts = Options(
        scene_model=args.scene_model,
        session_model=args.session_model,
        scene_effort=args.scene_effort,
        session_effort=args.session_effort,
        scene_gap=args.scene_gap,
        only_scene=args.only_scene,
        workers=args.workers,
        layers=args.layers,
        depth_model=args.depth_model,
        depth_effort=args.depth_effort,
    )
    try:
        result = Writer(session, runner, opts).run()
    except Exception as exc:
        write_status(session, "failed", f"The notes run crashed: {exc}")
        raise
    tokens_in = sum(r.input_tokens for r in runner.records)
    tokens_out = sum(r.output_tokens for r in runner.records)
    print(
        f"{result.scenes} scene(s) written to {session / 'notes'}, {result.fallbacks} kept raw; "
        f"{len(runner.records)} Claude call(s), {tokens_in} tokens in, {tokens_out} out."
    )
    counts = {
        "scenes": result.scenes,
        "fallbacks": result.fallbacks,
        "pending": result.pending + result.depth_missing + result.extras_missing,
    }
    if result.paused:
        why = "" if result.login_needed else "Paused by a usage limit: "
        print(f"{why}{result.paused}\nRun the same command again later.")
        write_status(session, "paused", f"{why}{result.paused}", **counts)
        return EXIT_PAUSED
    if result.summary_failed:
        if result.summary_given_up:
            msg = (
                f"The session summary could not be written after {result.summary_tries} runs; "
                "the scene notes are done. It is tried again only when the notes change."
            )
        else:
            msg = (
                f"The session summary could not be written (run {result.summary_tries} of "
                f"{MAX_FALLBACK_RUNS}); the scene notes are done. The next pass tries again."
            )
        print(msg)
        write_status(session, "failed", msg, reason="summary", **counts)
        return EXIT_SUMMARY_FAILED
    if result.pending or result.depth_missing or result.extras_missing:
        parts = []
        if result.pending:
            parts.append(f"{result.pending} scene(s) could not be written and are kept raw for now")
        if result.depth_missing:
            parts.append(f"{result.depth_missing} scene(s) have no in-depth notes yet")
        if result.extras_missing:
            parts.append(
                f"{result.extras_missing} of the character and worth-remembering notes are not written yet"
            )
        msg = "; ".join(parts) + "."
        print(f"{msg} Run the same command again to try them again.")
        write_status(session, "incomplete", msg, **counts)
        return EXIT_INCOMPLETE
    msg = "Notes written."
    if result.fallbacks:
        msg = f"Notes written, but {result.fallbacks} scene(s) stayed raw after repeated tries."
    write_status(session, "done", msg, **counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
