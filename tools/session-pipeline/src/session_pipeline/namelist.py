"""Build ``names.txt`` for a session: the names the speech-to-text step should listen for.

Sources, in priority order (the transcriber keeps the first names when its budget runs out):

1. a hand-kept extra list (``--extra``): one name per line, ``#`` comments allowed
2. player characters, then other character actors, then party/group actors
3. NPCs (actors of type ``npc``)
4. scene names
5. world items (``--items``) and journal names (``--journals``), off by default: item and journal
   names are mostly ordinary words ("Longsword", "Session notes") that crowd out real names

The world names come from the local co-GM dashboard: ``POST /api/tool`` with the read tool
``list-ref-choices`` (see ``.claude/skills/foundry-ai-tool/SKILL.md``). Standard library only. If
the dashboard cannot be reached the command still works from the extra list alone.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from session_pipeline.filters import parse_vocab

DEFAULT_DASHBOARD = "http://127.0.0.1:3100"
TOKEN_ENV = "GM_DASHBOARD_TOKEN"
MAX_NAME_WORDS = 5
_GENERIC = {
    "new scene",
    "untitled",
    "default",
    "default scene",
    "new actor",
    "new item",
    "new journal entry",
    "new journal",
    "scene",
    "actor",
    "item",
    "journal",
    "unnamed",
}
_BRACKETS = re.compile(r"\([^)]*\)|\[[^\]]*\]|\{[^}]*\}")
_TRAILING_NUMBER = re.compile(r"[\s#_-]*\d+$")

Fetch = Callable[[str, Mapping[str, Any] | None], list[dict[str, Any]]]


def clean_name(raw: str) -> str | None:
    """A speakable name from a Foundry document name, or None when it is not worth listening for.

    Drops bracketed parts ("Wolf (2)"), a trailing copy number ("Wolf 3") and commas (they separate
    hotwords), and skips empty, generic ("New Scene"), too short, too long or number-only names.
    """
    name = _BRACKETS.sub(" ", raw)
    name = _TRAILING_NUMBER.sub("", name)
    name = " ".join(name.replace(",", " ").split()).strip(" .:;-")
    if len(name) < 3 or len(name.split()) > MAX_NAME_WORDS:
        return None
    if not re.search(r"[^\W\d_]", name) or name.lower() in _GENERIC:
        return None
    return name


@dataclass(slots=True)
class WorldNames:
    """Names grouped by the priority order above (each list keeps the order Foundry returned)."""

    pcs: list[str] = field(default_factory=list)
    groups: list[str] = field(default_factory=list)
    npcs: list[str] = field(default_factory=list)
    scenes: list[str] = field(default_factory=list)
    items: list[str] = field(default_factory=list)
    journals: list[str] = field(default_factory=list)

    def ordered(self) -> list[str]:
        return [*self.pcs, *self.groups, *self.npcs, *self.scenes, *self.items, *self.journals]


def classify_actor(row: Mapping[str, Any]) -> str:
    """``pc``, ``group`` or ``npc`` from a ``list-ref-choices`` actor row (detail: "npc, player-owned")."""
    detail = str(row.get("detail") or "").lower()
    parts = {p.strip() for p in detail.split(",")}
    if "player-owned" in parts or "character" in parts:
        return "pc"
    if parts & {"group", "party", "encounter"}:
        return "group"
    if "npc" in parts:
        return "npc"
    return "skip"  # vehicles and other actor types are not spoken names


def collect_world_names(fetch: Fetch, items: bool = False, journals: bool = False) -> WorldNames:
    """Ask for actors, scenes and (optionally) items and journals through ``fetch(kind, filter)``."""
    out = WorldNames()
    seen: set[str] = set()

    def add(target: list[str], raw: Any) -> None:
        name = clean_name(str(raw))
        if name and name.lower() not in seen:
            seen.add(name.lower())
            target.append(name)

    actors = fetch("actor", None)
    for kind, target in (("pc", out.pcs), ("group", out.groups), ("npc", out.npcs)):
        for row in actors:  # PCs first, so a name shared with an NPC stays a PC
            if classify_actor(row) == kind:
                add(target, row.get("name", ""))
    for row in fetch("scene", None):
        add(out.scenes, row.get("name", ""))
    if items:
        for row in fetch("item", None):
            add(out.items, row.get("name", ""))
    if journals:
        for row in fetch("journal", None):
            add(out.journals, row.get("name", ""))
    return out


def dashboard_fetch(base_url: str, token: str | None = None, timeout: float = 10.0) -> Fetch:
    """A ``Fetch`` that calls the dashboard's ``POST /api/tool`` with ``list-ref-choices``."""

    def fetch(kind: str, filt: Mapping[str, Any] | None) -> list[dict[str, Any]]:
        args: dict[str, Any] = {"kind": kind, "limit": 500}
        if filt:
            args["filter"] = dict(filt)
        body = json.dumps({"name": "list-ref-choices", "args": args}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-CoGM-Token"] = token
        req = urllib.request.Request(base_url.rstrip("/") + "/api/tool", body, headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (local dashboard)
            payload = json.loads(resp.read().decode("utf-8"))
        return parse_choices(payload)

    return fetch


def parse_choices(payload: Any) -> list[dict[str, Any]]:
    """The rows of a ``/api/tool`` answer for ``list-ref-choices``; raises ValueError otherwise."""
    if not isinstance(payload, dict) or payload.get("ok") is False:
        error = payload.get("error") if isinstance(payload, dict) else payload
        raise ValueError(f"the dashboard refused the request: {error}")
    result = payload.get("result")
    choices = result.get("choices") if isinstance(result, dict) else None
    if not isinstance(choices, list):
        raise ValueError("unexpected answer from the dashboard (no result.choices)")
    return [c for c in choices if isinstance(c, dict) and c.get("name")]


def merge_names(*lists: Iterable[str]) -> list[str]:
    """Union in order, case-insensitive duplicates dropped (the first spelling wins)."""
    seen: set[str] = set()
    out: list[str] = []
    for names in lists:
        for n in names:
            n = " ".join(n.split())
            if n and n.lower() not in seen:
                seen.add(n.lower())
                out.append(n)
    return out


def read_extra(path: Path | None) -> list[str]:
    if path is None or not path.exists():
        return []
    return [n for n in parse_vocab(path.read_text(encoding="utf-8"))]


def render(names: list[str]) -> str:
    header = (
        "# Names for this session, most important first (the transcriber keeps the first ones\n"
        "# when its budget runs out). Built by `session_pipeline names`; edit the extra list, not this.\n"
    )
    return header + "".join(n + "\n" for n in names)


def build(
    fetch: Fetch | None,
    extra: list[str],
    items: bool = False,
    journals: bool = False,
) -> tuple[list[str], WorldNames | None, str | None]:
    """``(names, world names or None, warning or None)``. ``fetch`` None means offline."""
    world: WorldNames | None = None
    warning: str | None = None
    if fetch is not None:
        try:
            world = collect_world_names(fetch, items=items, journals=journals)
        except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as ex:
            reason = getattr(ex, "reason", ex)
            warning = f"could not read the world from the dashboard ({reason}); using the extra list only"
    names = merge_names(extra, world.ordered() if world else [])
    return names, world, warning


def default_token() -> str | None:
    return os.environ.get(TOKEN_ENV) or None
