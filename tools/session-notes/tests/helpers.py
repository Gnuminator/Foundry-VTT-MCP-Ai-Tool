"""Test helpers: a timeline on disk and a fake Claude that answers from the prompt."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from session_notes.claude_runner import LOGIN_HINT, AuthError, ClaudeError, UsageLimitError

LINE_RE = re.compile(r"^(u\d{6}) \[[\d:]+\] [^:]+: (.*?)(?:  \[unsure: .*\])?$", re.M)


def write_session(tmp: Path, rows: list[tuple[float, float, str, str]]) -> Path:
    """rows: (start, end, player, text). Returns the session folder."""
    tl = tmp / "timeline"
    tl.mkdir(parents=True)
    with (tl / "timeline.jsonl").open("w", encoding="utf-8") as fh:
        for start, end, player, text in rows:
            words = [{"word": w, "probability": 0.2 if w == "Sær" else 0.9} for w in text.split()]
            fh.write(
                json.dumps(
                    {
                        "start": start,
                        "end": end,
                        "speaker": player.lower(),
                        "player": player,
                        "character": "Ilvara" if player == "Anna" else player,
                        "text": text,
                        "words": words,
                    }
                )
                + "\n"
            )
    return tmp


def scene_answer(prompt: str, **overrides: Any) -> dict[str, Any]:
    lines = [
        {"id": m.group(1), "da": m.group(2), "en": f"EN {m.group(2)}", "ooc": False}
        for m in LINE_RE.finditer(prompt)
    ]
    first = lines[0]["id"] if lines else "u000001"
    answer: dict[str, Any] = {
        "lines": lines,
        "title_da": "Titel",
        "title_en": "Title",
        "summary_da": "Kort. Fortalt.",
        "summary_en": "Short. Told.",
        "setting": "game",
        "events": [{"da": "Noget skete", "en": "Something happened", "cites": [first, "u999999"]}],
        "decisions": [],
        "npcs": [{"name": "Madam Eva", "da": "Spåkone", "en": "Fortune teller", "cites": [first]}],
        "threads": [],
        "quotes": [{"id": first, "spoken": "Hej", "spoken_lang": "da", "en": "Hi"}],
        "gm_only": [{"da": "Hemmelig", "en": "Secret", "cites": [first]}],
        "table": [],
        "table_note": {"da": "", "en": ""},
    }
    answer.update(overrides)
    return answer


SESSION_ANSWER = {
    "title_da": "Session",
    "title_en": "Session",
    "summary_da": "Resumé.",
    "summary_en": "Summary.",
    "in_short_da": ["Et", "To", "Tre", "Fire", "Fem"],
    "in_short_en": ["One", "Two", "Three", "Four", "Five"],
    "changed_da": ["A"],
    "changed_en": ["A"],
    "recap_player_da": "Sidst...",
    "recap_player_en": "Previously...",
}


class FakeClaude:
    """Answers scene prompts from the prompt text; scripted failures by call number."""

    def __init__(self, fail: dict[int, str] | None = None, bad_lines: set[int] | None = None):
        self.calls: list[tuple[str, str]] = []
        self.fail = fail or {}
        self.bad_lines = bad_lines or set()
        self.efforts: list[str] = []

    def __call__(
        self, prompt: str, schema: dict[str, Any], model: str, effort: str = "low"
    ) -> dict[str, Any]:
        n = len(self.calls) + 1
        self.efforts.append(effort)
        props = schema["properties"]
        kind = (
            "scene"
            if "lines" in props
            else "depth"
            if "beats" in props
            else "characters"
            if "characters" in props
            else "remember"
            if "items" in props
            else "moment"
            if "moments" in props
            else "session"
        )
        self.calls.append((kind, prompt))
        if self.fail.get(n) == "limit":
            raise UsageLimitError("Claude usage limit reached")
        if self.fail.get(n) == "auth":
            raise AuthError(f"{LOGIN_HINT}: Failed to authenticate")
        if self.fail.get(n) == "error":
            raise ClaudeError("boom")
        if kind == "session":
            return dict(SESSION_ANSWER)
        if kind == "moment":
            ids = re.findall(r"\bu\d{6}\b", prompt)
            return {
                "moments": [
                    {
                        "da": "Ilvara greb øjeblikket",
                        "en": "Ilvara seized the moment",
                        "reason_da": "Hele bordet jublede",
                        "reason_en": "The whole table cheered",
                        "cites": [ids[0], "u999999"],
                    }
                ]
            }
        if kind in ("characters", "remember"):
            ids = re.findall(r"\bu\d{6}\b", prompt)
            point = {"da": "Punkt", "en": "Point", "cites": [ids[0], "u999999"]}
            if kind == "remember":
                return {"items": [{"kind": "agreement", **point}, {"kind": "weird", **point}]}
            chars = re.findall(r"^- (\S+) \(played by (\S+)\)$", prompt, re.M)
            return {
                "characters": [
                    {
                        "name": c,
                        "player": p,
                        "revealed": [point],
                        "choices": [],
                        "ties": [point],
                        "hooks": [],
                        "wishes": [],
                        "gm_only": [],
                    }
                    for c, p in chars
                ]
            }
        if kind == "depth":
            ids = re.findall(r"^(u\d{6}) \[", prompt, re.M)
            return {
                "beats": [
                    {"heading": "Første del", "text": "De går videre.", "cites": [ids[0], "u999999"]}
                ]
            }
        answer = scene_answer(prompt)
        if n in self.bad_lines:
            answer["lines"] = answer["lines"][:-1]  # drop a line: fails the hard check
        return answer
