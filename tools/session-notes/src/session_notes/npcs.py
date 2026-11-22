"""NPC names: one label per language, and one entry per NPC however the table spelled the name.

Speech recognition and the table itself give the same NPC several spellings in one session
(Vesperholt, Vesperhult). The scene writer is asked to put them in one entry with ``aliases``;
this module makes sure of it afterwards, inside a scene and across the scenes of a session, so
the notes show one name (the first one heard) and list the other spellings.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

# Names this close (word-letter similarity) are taken as the same NPC. Short names must match
# exactly: "Ula" and "Ulf" are two people.
SIMILAR = 0.84
MIN_FUZZY_LEN = 6
_NON_WORD = re.compile(r"[\W_]+", re.UNICODE)


def _key(name: str) -> str:
    return _NON_WORD.sub("", name.casefold())


def _spellings(npc: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for raw in (npc.get("name_da"), npc.get("name_en"), npc.get("name"), *(npc.get("aliases") or [])):
        text = str(raw or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def same_npc(a: dict[str, Any], b: dict[str, Any]) -> bool:
    for x in _spellings(a):
        kx = _key(x)
        for y in _spellings(b):
            ky = _key(y)
            if not kx or not ky:
                continue
            if kx == ky:
                return True
            if min(len(kx), len(ky)) >= MIN_FUZZY_LEN and SequenceMatcher(None, kx, ky).ratio() >= SIMILAR:
                return True
    return False


def normalize(npc: dict[str, Any]) -> dict[str, Any]:
    """Old notes had one ``name``; give every entry ``name_da``, ``name_en`` and ``aliases``."""
    out = dict(npc)
    legacy = str(out.pop("name", "") or "").strip()
    out["name_da"] = str(out.get("name_da") or legacy or out.get("name_en") or "").strip()
    out["name_en"] = str(out.get("name_en") or legacy or out["name_da"]).strip()
    out["aliases"] = [str(a).strip() for a in out.get("aliases") or [] if str(a).strip()]
    return out


def _tidy_aliases(npc: dict[str, Any], extra: list[str]) -> None:
    shown = {_key(npc["name_da"]), _key(npc["name_en"])}
    aliases: list[str] = []
    for a in [*npc["aliases"], *extra]:
        if _key(a) not in shown and _key(a) not in {_key(x) for x in aliases}:
            aliases.append(a)
    npc["aliases"] = aliases


def _join(a: str, b: str) -> str:
    if not b or b in a:
        return a
    return f"{a} {b}".strip() if a else b


def _absorb(into: dict[str, Any], other: dict[str, Any]) -> None:
    extra = [n for n in _spellings(other)]
    into["da"] = _join(str(into.get("da", "")), str(other.get("da", "")))
    into["en"] = _join(str(into.get("en", "")), str(other.get("en", "")))
    into["cites"] = list(dict.fromkeys([*into.get("cites", []), *other.get("cites", [])]))
    _tidy_aliases(into, extra)


def merge_scene_npcs(npcs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One entry per NPC in one scene; the variants go to ``aliases``."""
    merged: list[dict[str, Any]] = []
    for raw in npcs:
        npc = normalize(raw)
        _tidy_aliases(npc, [])
        for kept in merged:
            if same_npc(kept, npc):
                _absorb(kept, npc)
                break
        else:
            merged.append(npc)
    return merged


def canonicalize(notes: list[dict[str, Any]]) -> int:
    """Across a session's scenes: an NPC heard again under another spelling gets the name it had
    first, and the variant is listed. Changes the notes in place; returns how many were renamed."""
    seen: list[dict[str, Any]] = []
    renamed = 0
    for scene in notes:
        if not scene.get("npcs"):
            continue
        out = []
        for npc in merge_scene_npcs(scene["npcs"]):
            for first in seen:
                if same_npc(first, npc):
                    spelled = _spellings(npc)
                    if _key(npc["name_en"]) != _key(first["name_en"]) or _key(npc["name_da"]) != _key(first["name_da"]):
                        renamed += 1
                    npc["name_da"], npc["name_en"] = first["name_da"], first["name_en"]
                    _tidy_aliases(npc, spelled)
                    _tidy_aliases(first, spelled)
                    break
            else:
                seen.append(dict(npc))
            out.append(npc)
        scene["npcs"] = out
    return renamed


def label(npc: dict[str, Any], lang: str) -> str:
    """The name to show in ``lang`` notes, with the other spellings, for old and new notes."""
    n = normalize(npc)
    name = n[f"name_{lang}"]
    if n["aliases"]:
        also = "også hørt som" if lang == "da" else "also heard as"
        return f"{name} ({also}: {', '.join(n['aliases'])})"
    return name
