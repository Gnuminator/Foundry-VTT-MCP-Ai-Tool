"""The table agenda that carries over (backlog item ``table-agenda``).

Every "Proposed, not settled" and "Open at the table" line of a session's Table page becomes an
agenda item with a status (open, settled, dropped) and the session it came from. The list lives in
one file for the whole campaign, ``table-agenda.json`` in the sessions folder (next to the session
folders), so it outlives a single run. A later session whose House rules line answers an open item
marks it settled and links the line. The prep digest reads the open items, and each session folder
gets ``notes/agenda.<lang>.md``: the "Settle at the start" list Danni reads out in five minutes.

Deterministic on purpose: no Claude call. A House rules line settles an item of an *earlier*
session when they share enough of the same content words; anything less sure stays open for Danni
to settle or drop by hand (``session-notes agenda --settle ID`` / ``--drop ID``).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from .fmt import NONE
from .model import clock

AGENDA_FILE = "table-agenda.json"
OPEN_TOPICS = ("proposed", "open")
STATUSES = ("open", "settled", "dropped")
LANGS = ("da", "en")
MIN_SHARED = 2  # content words two lines must share
MIN_RATIO = 0.4  # ... and that share of the shorter line's words

STOP = frozenset(
    "the and for that this with from have has had are was were will would should could not but "
    "you your they them their there then than into about what when who which can all any out "
    "rule rules house regel regler husregel husregler one two use used also just only more some very over under each every "
    "der det den dem de en et og at er som til for med har har var vil skal kan ikke men "
    "der hvis så på af om vi os jer du dig".split()
)

HEAD = {
    "da": {
        "title": "Bordets dagsorden",
        "start": "Afgør ved start",
        "settled": "Afgjort",
        "dropped": "Droppet",
        "from": "fra",
        "by": "afgjort",
        "intro": "Åbne spørgsmål fra tidligere sessioner. Danni afgør eller dropper dem.",
    },
    "en": {
        "title": "Table agenda",
        "start": "Settle at the start",
        "settled": "Settled",
        "dropped": "Dropped",
        "from": "from",
        "by": "settled",
        "intro": "Open questions carried over from earlier sessions. Danni settles or drops them.",
    },
}


def agenda_path(sessions_root: Path) -> Path:
    return sessions_root / AGENDA_FILE


def item_id(session: str, topic: str, en: str, da: str) -> str:
    """Stable per session and wording, so a re-run keeps the status of an item."""
    key = f"{session}|{topic}|{(en or da).casefold().strip()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:10]


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.casefold()) if len(w) >= 4 and w not in STOP}


def matches(item: str, other: str) -> bool:
    """``other`` is about the same thing as ``item``: at least two content words of both languages
    shared, and that share is at least MIN_RATIO of the item's own words (a one-word item never
    matches by itself; it stays open for Danni to settle)."""
    wa, wb = words(item), words(other)
    shared = len(wa & wb)
    return shared >= MIN_SHARED and shared / len(wa) >= MIN_RATIO


def _both(en: Any, da: Any) -> str:
    return f"{en or ''} {da or ''}"


def _write(sessions_root: Path, agenda: dict[str, Any]) -> None:
    """Atomic: a crash mid-write never leaves a half file; the readable pages follow."""
    sessions_root.mkdir(parents=True, exist_ok=True)
    path = agenda_path(sessions_root)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(agenda, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    for lang in LANGS:
        (sessions_root / f"table-agenda.{lang}.md").write_text(
            render(agenda, lang), encoding="utf-8", newline="\n"
        )


def load(sessions_root: Path) -> dict[str, Any]:
    path = agenda_path(sessions_root)
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return {"schema": 1, "items": []}
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        # never lose Danni's decisions to a bad file: keep it aside and say so
        try:
            os.replace(path, path.with_name(path.name + ".bak"))
            print(f"table agenda: {path} could not be read; kept as {path.name}.bak", file=sys.stderr)
        except OSError:
            pass
        return {"schema": 1, "items": []}
    data["items"] = [i for i in data["items"] if isinstance(i, dict) and i.get("session") and i.get("id")]
    return data


def _starts(lines: list[Any]) -> dict[str, float]:
    return {ln.id: ln.start for ln in lines}


def _link(session: str, lang: str, ids: list[str], starts: dict[str, float]) -> dict[str, str] | None:
    known = [i for i in ids if i in starts]
    if not known:
        return None
    first = min(known, key=lambda i: starts[i])
    return {"session": session, "ref": f"transcript.{lang}#^{first}", "time": clock(starts[first])}


def _table_items(notes: list[dict[str, Any]], topics: tuple[str, ...]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for scene in notes:
        for item in scene.get("table") or []:
            topic = item.get("topic")
            text = str(item.get("en") or item.get("da") or "").strip().casefold()
            if topic not in topics or not text or (topic, text) in seen:
                continue
            seen.add((topic, text))
            out.append(item)
    return out


def update(
    sessions_root: Path, session: str, notes: list[dict[str, Any]], lines: list[Any]
) -> dict[str, Any]:
    """Fold one finished session into the agenda and write the file. Returns the agenda."""
    agenda = load(sessions_root)
    starts = _starts(lines)
    mine = [i for i in agenda["items"] if i["session"] == session]
    old = {i["id"]: i for i in mine}
    # this session's items are rebuilt from its notes; a status Danni or an earlier run gave stays
    items = [i for i in agenda["items"] if i["session"] != session]
    for raw in _table_items(notes, OPEN_TOPICS):
        en, da = str(raw.get("en", "")).strip(), str(raw.get("da", "")).strip()
        iid = item_id(session, raw["topic"], en, da)
        prev = old.pop(iid, None)
        if prev is None:  # the notes were reworded on a re-run: the same question keeps its status
            same = next(
                (
                    o
                    for o in old.values()
                    if o["topic"] == raw["topic"] and matches(_both(o.get("en"), o.get("da")), _both(en, da))
                ),
                None,
            )
            if same is not None:
                prev = old.pop(same["id"])
        prev = prev or {}
        link = _link(session, "en", list(raw.get("cites", [])), starts)
        item: dict[str, Any] = {
            "id": iid,
            "session": session,
            "topic": raw["topic"],
            "en": en,
            "da": da,
            "status": prev.get("status", "open"),
        }
        if link:
            item["source"] = link
        if prev.get("settledBy"):
            item["settledBy"] = prev["settledBy"]
        items.append(item)
    # House rules of this session settle open items of earlier sessions (folder names start with the date)
    for raw in _table_items(notes, ("house_rules",)):
        link = _link(session, "en", list(raw.get("cites", [])), starts)
        for item in items:
            if item["status"] != "open" or item["session"] >= session:
                continue
            if matches(_both(item.get("en"), item.get("da")), _both(raw.get("en"), raw.get("da"))):
                item["status"] = "settled"
                item["settledBy"] = {
                    "session": session,
                    "en": str(raw.get("en", "")).strip(),
                    "da": str(raw.get("da", "")).strip(),
                    **({"ref": link["ref"], "time": link["time"]} if link else {}),
                }
    items.sort(key=lambda i: (i["session"], i["id"]))
    agenda["items"] = items
    _write(sessions_root, agenda)
    return agenda


def set_status(sessions_root: Path, item: str, status: str) -> dict[str, Any]:
    """Danni settles or drops an item by hand (an id prefix is enough)."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {', '.join(STATUSES)}")
    agenda = load(sessions_root)
    hits = [i for i in agenda["items"] if str(i.get("id", "")).startswith(item)]
    if len(hits) != 1:
        raise ValueError(f"{len(hits)} agenda items match {item!r}; give more of the id")
    hits[0]["status"] = status
    if status != "settled":
        hits[0].pop("settledBy", None)
    _write(sessions_root, agenda)
    return hits[0]


def open_items(agenda: dict[str, Any]) -> list[dict[str, Any]]:
    return [i for i in agenda.get("items", []) if i.get("status") == "open"]


def _line(item: dict[str, Any], lang: str, h: dict[str, str]) -> str:
    text = item.get(lang) or item.get("en") or item.get("da") or ""
    src = item.get("source")
    out = f"- {text}{_stamp(item['session'], src, lang)} ({h['from']} {item['session']}, `{item['id']}`)"
    by = item.get("settledBy")
    if by:
        out += (
            f"; {h['by']} {by['session']}{_stamp(by['session'], by, lang)}: "
            f"{by.get(lang) or by.get('en') or by.get('da') or ''}"
        )
    return out


def _stamp(session: str, src: dict[str, Any] | None, lang: str) -> str:
    """A link to the transcript line, qualified by the session folder (every session has a transcript)."""
    if not src or not src.get("ref") or not src.get("time"):
        return ""
    anchor = str(src["ref"]).split("#", 1)[-1]
    return f" ([[{session}/notes/transcript.{lang}#{anchor}|{src['time']}]])"


def render(agenda: dict[str, Any], lang: str) -> str:
    h = HEAD[lang]
    out = [f"# {h['title']}", "", h["intro"], ""]
    for status, heading in (("open", h["start"]), ("settled", h["settled"]), ("dropped", h["dropped"])):
        rows = [i for i in agenda.get("items", []) if i.get("status") == status]
        out += [f"## {heading}", ""]
        out += ([_line(i, lang, h) for i in rows] + [""]) if rows else [NONE[lang], ""]
    return "\n".join(out)
