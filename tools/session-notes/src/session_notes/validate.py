"""Check Claude's scene output before trusting it.

Hard problems (the scene is retried): lines missing, extra, duplicated or out of order.
Soft fixes (applied, logged): a cleaned line that drifted too far from what was said is put back
to the raw text (the clean-up is a correction, not a rewrite), and citations of unknown ids are
dropped.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from .model import Scene

# Below this word-level similarity to the raw text a "cleaned" line counts as rewritten.
MIN_SIMILARITY = 0.4
# Shorter lines are not judged: one fixed name can change half of a short line.
MIN_WORDS = 5
_LISTS = ("events", "decisions", "npcs", "loot", "threads", "dice", "gm_only")
_WORD = re.compile(r"\w+", re.UNICODE)


def similarity(a: str, b: str) -> float:
    """Word-level similarity (characters are too lenient: unrelated sentences share letters)."""
    return SequenceMatcher(None, _WORD.findall(a.lower()), _WORD.findall(b.lower())).ratio()


def check_lines(result: dict[str, Any], scene: Scene) -> list[str]:
    got = [str(line.get("id")) for line in result.get("lines", [])]
    want = scene.ids
    if got == want:
        return []
    problems = []
    missing = [i for i in want if i not in got]
    extra = [i for i in got if i not in want]
    if missing:
        problems.append(f"missing lines {missing[:5]}{'...' if len(missing) > 5 else ''}")
    if extra:
        problems.append(f"unknown lines {extra[:5]}")
    if len(got) != len(set(got)):
        problems.append("duplicated lines")
    if not problems:
        problems.append("lines out of order")
    return problems


def repair(result: dict[str, Any], scene: Scene) -> list[str]:
    """Apply the soft fixes in place; return a log of what was changed."""
    log: list[str] = []
    raw = {line.id: line.text for line in scene.lines}
    for line in result["lines"]:
        original = raw[line["id"]]
        best = max(similarity(original, line["da"]), similarity(original, line["en"]))
        if len(_WORD.findall(original)) >= MIN_WORDS and best < MIN_SIMILARITY:
            log.append(f"{line['id']}: cleaned text too far from the raw text, kept raw")
            closer_da = similarity(original, line["da"]) >= similarity(original, line["en"])
            line["da" if closer_da else "en"] = original
            line["raw_kept"] = True
    known = set(raw)
    for key in _LISTS:
        for entry in result.get(key, []):
            bad = [c for c in entry.get("cites", []) if c not in known]
            if bad:
                entry["cites"] = [c for c in entry["cites"] if c in known]
                log.append(f"{key}: dropped unknown citations {bad[:3]}")
    quotes = result.get("quotes", [])
    kept = [q for q in quotes if q.get("id") in known]
    if len(kept) != len(quotes):
        log.append(f"quotes: dropped {len(quotes) - len(kept)} with unknown ids")
        result["quotes"] = kept
    return log


def raw_fallback(scene: Scene) -> dict[str, Any]:
    """Notes for a scene Claude could not handle: the raw text, nothing else."""
    return {
        "lines": [
            {"id": ln.id, "da": ln.text, "en": ln.text, "ooc": False, "raw_kept": True}
            for ln in scene.lines
        ],
        "title_da": f"Scene {scene.index} (ikke behandlet)",
        "title_en": f"Scene {scene.index} (not processed)",
        "summary_da": "",
        "summary_en": "",
        **{key: [] for key in _LISTS},
        "quotes": [],
        "fallback": True,
    }


def combine(parts: list[dict[str, Any]]) -> dict[str, Any]:
    """Join the notes of the halves of a scene that had to be split."""
    first = parts[0]
    out: dict[str, Any] = {
        "lines": [line for p in parts for line in p["lines"]],
        "title_da": first["title_da"],
        "title_en": first["title_en"],
        "summary_da": " ".join(p["summary_da"] for p in parts if p["summary_da"]),
        "summary_en": " ".join(p["summary_en"] for p in parts if p["summary_en"]),
        "quotes": [q for p in parts for q in p["quotes"]][:3],
    }
    for key in _LISTS:
        out[key] = [e for p in parts for e in p[key]]
    if any(p.get("fallback") for p in parts):
        out["fallback"] = True
    return out
