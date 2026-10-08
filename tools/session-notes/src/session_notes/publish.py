"""``session-notes publish <session>``: hand the notes to the bridge (recap lane, D-087).

The bridge keeps them in its vault and puts them into a GM-only Foundry journal by itself as soon
as a GM's Foundry client is connected with writes and the session-notes switch on. This step:

1. builds the three pages from ``notes/notes.json`` as plain HTML (``h2``, ``h3``, ``p``, ``ul``,
   ``li``, ``em``, ``strong``; the bridge sanitizes again): Recap, GM summary, Scenes, each with
   Danish first and English under an ``English`` heading. The transcript stays on the PC, and
   the citation links into it are left out.
2. stages them over the bridge's control port (``session_notes``, JSON lines;
   ``FOUNDRY_AI_CONTROL_PORT``, default 31414, the test bridge is 31514; the host is
   ``MCP_CONTROL_HOST``, default 127.0.0.1, the Pi's Tailscale name once the bridge runs there),
   once per session.
3. asks for the status and, when the GM approved the notes (revealed the Recap, or "Approve
   without revealing"), writes ``notes/approved.json`` (the audio is kept, D-097).

Exit codes: 0 done, 1 error, 3 the bridge cannot take it now (not running, or Foundry closed and
no ``FVTT_WORLD`` set); the next pass tries again.
"""

from __future__ import annotations

import html
import json
import os
import re
import socket
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .retention import APPROVED, approve

DEFAULT_PORT = 31414
EXIT_LATER = 3
PUBLISHED = "published.json"
SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
DATE_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2})")

PAGE_TITLES = {"recap": "Recap", "summary": "GM summary", "scenes": "Scenes"}
SECTION_TITLES = {
    "da": {
        "changed": "Hvad ændrede sig",
        "events": "Hændelser",
        "decisions": "Beslutninger",
        "npcs": "NPC'er",
        "loot": "Fund og tab",
        "threads": "Åbne tråde",
        "dice": "Terninger",
        "quotes": "Citater",
        "gm_only": "Kun for GM",
    },
    "en": {
        "changed": "What changed",
        "events": "Events",
        "decisions": "Decisions",
        "npcs": "NPCs",
        "loot": "Loot and losses",
        "threads": "Open threads",
        "dice": "Dice",
        "quotes": "Quotes",
        "gm_only": "GM only",
    },
}
SCENE_SECTIONS = ("events", "decisions", "npcs", "loot", "threads", "dice", "quotes", "gm_only")


class BridgeError(Exception):
    """The bridge refused (``code`` set) or could not be reached (``code`` None)."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Markdown-ish text to HTML
# ---------------------------------------------------------------------------


def inline(text: str) -> str:
    """Escape, then ``**strong**`` and ``*em*`` (the only inline Markdown the notes use)."""
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", out)
    return out


def blocks(text: str) -> str:
    """Paragraphs split on blank lines; a block of ``- `` lines becomes a list."""
    out: list[str] = []
    for block in re.split(r"\n\s*\n", (text or "").strip()):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        if all(ln.startswith(("- ", "* ")) for ln in lines):
            out.append("<ul>" + "".join(f"<li>{inline(ln[2:])}</li>" for ln in lines) + "</ul>")
        else:
            out.append(f"<p>{inline(' '.join(lines))}</p>")
    return "".join(out)


def bullets(items: list[str]) -> str:
    items = [i for i in items if i and i.strip()]
    return "<ul>" + "".join(f"<li>{inline(i.strip())}</li>" for i in items) + "</ul>" if items else ""


def clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------


def both(render: Any) -> str:
    """Danish first, then English under an ``English`` heading (one page, D-087)."""
    return render("da") + "<h2>English</h2>" + render("en")


def recap_html(session: dict[str, Any]) -> str:
    return both(lambda lang: blocks(session.get(f"recap_player_{lang}", "")))


def summary_html(session: dict[str, Any]) -> str:
    def render(lang: str) -> str:
        changed = bullets(list(session.get(f"changed_{lang}") or []))
        head = f"<h3>{SECTION_TITLES[lang]['changed']}</h3>" if changed else ""
        return blocks(session.get(f"summary_{lang}", "")) + head + changed

    return both(render)


def scenes_html(scenes: list[dict[str, Any]]) -> str:
    def render(lang: str) -> str:
        out: list[str] = []
        titles = SECTION_TITLES[lang]
        for scene in scenes:
            title = scene.get(f"title_{lang}") or ""
            out.append(f"<h2>{scene.get('index', '')}. {inline(title)}</h2>")
            if "start" in scene and "end" in scene:
                out.append(f"<p><em>{clock(scene['start'])} to {clock(scene['end'])}</em></p>")
            out.append(blocks(scene.get(f"summary_{lang}") or ""))
            for key in SCENE_SECTIONS:
                entries = scene.get(key) or []
                items: list[str] = []
                for e in entries:
                    text = e.get(lang) or ""
                    if key == "npcs":
                        items.append(f"**{e.get('name', '')}**: {text}")
                    elif key == "quotes":
                        items.append(f'"{text}"')
                    else:
                        items.append(text)
                listed = bullets(items)
                if listed:
                    out.append(f"<h3>{titles[key]}</h3>{listed}")
        return "".join(out)

    return both(render)


@dataclass
class Staged:
    session_id: str
    date: str
    title: str
    pages: list[dict[str, str]]


def build(session: Path) -> Staged:
    """The stage request for one session folder (notes must be written)."""
    path = session / "notes" / "notes.json"
    if not path.exists():
        raise FileNotFoundError(f"No notes in {path.parent}; run session-notes run first.")
    data = json.loads(path.read_text(encoding="utf-8"))
    s = data.get("session")
    if not s:
        raise FileNotFoundError(f"The notes in {path.parent} are not finished (no session part).")
    session_id = session_id_for(session)
    m = DATE_PREFIX.match(session.name)
    date = m.group(1) if m else datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d")
    title = (s.get("title_da") or s.get("title_en") or session.name).strip()
    pages = [
        {"key": "recap", "title": PAGE_TITLES["recap"], "html": recap_html(s)},
        {"key": "summary", "title": PAGE_TITLES["summary"], "html": summary_html(s)},
    ]
    scenes = data.get("scenes") or []
    if scenes:
        pages.append({"key": "scenes", "title": PAGE_TITLES["scenes"], "html": scenes_html(scenes)})
    return Staged(session_id, date, title, pages)


def session_id_for(session: Path) -> str:
    sid = re.sub(r"[^A-Za-z0-9_-]+", "-", session.name).strip("-_")[:80]
    if not SESSION_ID.match(sid):
        raise ValueError(f"Cannot make a session id from the folder name {session.name!r}")
    return sid


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------


def control_port() -> int:
    raw = os.environ.get("FOUNDRY_AI_CONTROL_PORT") or os.environ.get("MCP_CONTROL_PORT")
    return int(raw) if raw else DEFAULT_PORT


def control_host() -> str:
    return os.environ.get("FOUNDRY_AI_CONTROL_HOST") or os.environ.get("MCP_CONTROL_HOST") or "127.0.0.1"


def call(port: int, params: dict[str, Any], timeout: float = 60.0, host: str | None = None) -> Any:
    """One ``session_notes`` request on the control port; raises BridgeError."""
    host = host or control_host()
    request = {"id": uuid.uuid4().hex, "method": "session_notes", "params": params}
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.sendall((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
            buf = b""
            while b"\n" not in buf:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                buf += chunk
    except OSError as exc:
        raise BridgeError(f"The bridge on {host}:{port} is not reachable: {exc}") from exc
    if not buf.strip():
        raise BridgeError(f"The bridge on port {port} closed without an answer")
    answer = json.loads(buf.split(b"\n", 1)[0].decode("utf-8"))
    error = answer.get("error")
    if error:
        raise BridgeError(error.get("message", "refused"), error.get("code"))
    return answer.get("result")


@dataclass
class Outcome:
    code: int
    message: str
    item: dict[str, Any] | None = None


def publish(session: Path, port: int | None = None, world: str | None = None, restage: bool = False) -> Outcome:
    """Stage once, then follow the status; writes ``approved.json`` once the GM approved."""
    port = port or control_port()
    world = world or os.environ.get("FVTT_WORLD") or None
    staged = build(session)
    marker = session / "notes" / PUBLISHED
    item: dict[str, Any] | None = None
    try:
        if not restage:
            try:
                params: dict[str, Any] = {"action": "status", "sessionId": staged.session_id}
                if world:
                    params["world"] = world
                item = call(port, params)
            except BridgeError as exc:
                if exc.code != "not-found":
                    raise
        if item is None:
            params = {
                "action": "stage",
                "sessionId": staged.session_id,
                "date": staged.date,
                "title": staged.title,
                "languages": ["da", "en"],
                "pages": staged.pages,
            }
            if world:
                params["world"] = world
            item = call(port, params)
            marker.write_text(
                json.dumps(
                    {"sessionId": staged.session_id, "stagedAt": item.get("stagedAt"), "port": port}
                )
                + "\n",
                encoding="utf-8",
            )
    except BridgeError as exc:
        if exc.code in (None, "no-world", "not-connected"):
            return Outcome(EXIT_LATER, f"Not published yet: {exc}")
        return Outcome(1, f"The bridge refused: {exc} ({exc.code})")

    approved = item.get("approvedAt")
    if approved and not (session / "notes" / APPROVED).exists():
        when = datetime.fromisoformat(approved.replace("Z", "+00:00"))
        approve(session, by=f"{item.get('approvedBy') or 'GM'} (Foundry)", now=when)
    return Outcome(0, describe(item), item)


def describe(item: dict[str, Any]) -> str:
    status = item.get("status")
    if status == "approved":
        how = "the Recap was revealed" if item.get("approvedBy") == "reveal" else "approved"
        return f"{item['sessionId']}: approved in Foundry ({how})"
    if status == "in-foundry":
        return f"{item['sessionId']}: in Foundry, waiting for the GM to reveal or approve the Recap"
    waiting = item.get("waitingFor") or []
    if not item.get("autoPut"):
        return f"{item['sessionId']}: staged; the GM took it back (Undo), it waits for a manual put"
    if waiting:
        reasons = {
            "foundry": "Foundry to be open",
            "writes-off": '"Allow Write Operations"',
            "feature-off": 'the "Session notes" switch',
        }
        return f"{item['sessionId']}: staged, waiting for " + ", ".join(reasons.get(w, w) for w in waiting)
    return f"{item['sessionId']}: staged, going into Foundry now"
