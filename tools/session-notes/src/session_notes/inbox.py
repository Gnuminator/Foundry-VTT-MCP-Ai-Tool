"""Recap inbox (I-132): let a cloud routine write the notes while the PC is off.

The PC transcribes (GPU, local) and then copies only the merged timeline text and the names list
into a clone of a PRIVATE git repo (the inbox). A scheduled cloud routine runs ``run`` on each
pending session folder in that clone and pushes the notes back. The next PC pass copies finished
notes into the real session folder. Audio never leaves the PC. Consent is checked before export
(D-097). The inbox repo must be private: it holds player speech as text, never put it in the
public repo.

Layout inside the inbox clone::

    sessions/<session name>/timeline/timeline.jsonl
    sessions/<session name>/names.txt            (when the session has one)
    sessions/<session name>/notes/...            (written by the routine)

The whole feature is off unless ``FVTT_RECAP_INBOX`` points at the clone. The clone needs an
upstream branch (``git clone`` or ``git push -u`` sets it): the pass pulls with rebase and
autostash, and pushes only when commits are ahead of ``@{u}``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .consent import check_consent

SESSIONS_DIR = "sessions"
TIMELINE = Path("timeline") / "timeline.jsonl"


@dataclass
class SyncReport:
    exported: list[str] = field(default_factory=list)
    imported: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def lines(self) -> list[str]:
        out = [f"exported {n}" for n in self.exported]
        out += [f"imported notes for {n}" for n in self.imported]
        out += [f"skipped {s}" for s in self.skipped]
        return out or ["nothing to do"]


def notes_done(session: Path) -> bool:
    return (session / "notes" / "notes.json").is_file()


def pending(inbox: Path) -> list[Path]:
    """Session folders in the inbox that have a timeline but no finished notes yet."""
    root = inbox / SESSIONS_DIR
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if (p / TIMELINE).is_file() and not notes_done(p))


def export_session(session: Path, sessions_root: Path, inbox: Path) -> str | None:
    """Copy the timeline text (and names.txt) into the inbox. Returns a reason when skipped."""
    if not (session / TIMELINE).is_file():
        return "no timeline yet"
    if notes_done(session):
        return "notes already written"
    consent = check_consent(session, sessions_root)
    if not consent.ok:
        return f"no consent: {consent.message}"
    dest = inbox / SESSIONS_DIR / session.name
    if (dest / TIMELINE).is_file():
        return "already in the inbox"
    (dest / "timeline").mkdir(parents=True, exist_ok=True)
    shutil.copy2(session / TIMELINE, dest / TIMELINE)
    names = session / "names.txt"
    if names.is_file():
        shutil.copy2(names, dest / "names.txt")
    return None


def import_notes(inbox: Path, sessions_root: Path) -> list[str]:
    """Copy notes the routine finished into the matching local session folders."""
    done: list[str] = []
    root = inbox / SESSIONS_DIR
    if not root.is_dir():
        return done
    for remote in sorted(p for p in root.iterdir() if p.is_dir()):
        local = sessions_root / remote.name
        if not local.is_dir() or not notes_done(remote) or notes_done(local):
            continue
        if any(p.name != ".work" for p in (local / "notes").glob("*")):
            continue  # local notes already started: never overwrite them
        shutil.copytree(
            remote / "notes",
            local / "notes",
            dirs_exist_ok=True,
            symlinks=True,
            ignore=shutil.ignore_patterns(".work"),
        )
        done.append(remote.name)
    return done


def _git(inbox: Path, *args: str) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(inbox), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"git {' '.join(args)} could not run: {exc}") from exc
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {(proc.stderr or proc.stdout).strip()}")
    return proc.stdout


def sync(sessions_root: Path, inbox: Path, *, use_git: bool = True) -> SyncReport:
    """One PC pass: pull the inbox, import finished notes, export new sessions, push."""
    report = SyncReport()
    if use_git:
        _git(inbox, "pull", "--rebase", "--autostash")
    report.imported = import_notes(inbox, sessions_root)
    if sessions_root.is_dir():
        for session in sorted(p for p in sessions_root.iterdir() if p.is_dir()):
            if not (session / TIMELINE).is_file():
                continue
            reason = export_session(session, sessions_root, inbox)
            if reason is None:
                report.exported.append(session.name)
            elif not reason.startswith(("already", "notes already")):
                report.skipped.append(f"{session.name} ({reason})")
    if use_git:
        # Decide on git state, not on this pass: a failed commit or push is retried next pass.
        _git(inbox, "add", "-A", SESSIONS_DIR)
        if _git(inbox, "status", "--porcelain", SESSIONS_DIR).strip():
            _git(inbox, "commit", "-m", "inbox: " + (", ".join(report.exported) or "update"))
        if _git(inbox, "rev-list", "@{u}..HEAD").strip():
            _git(inbox, "push")
    return report
