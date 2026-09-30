"""Test helpers: a timeline on disk and a fake Claude that answers from the prompt."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from session_notes.claude_runner import ClaudeError, UsageLimitError

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
                        "character": "Ireena" if player == "Anna" else player,
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
        "summary_da": "Kort.",
        "summary_en": "Short.",
        "events": [{"da": "Noget skete", "en": "Something happened", "cites": [first, "u999999"]}],
        "decisions": [],
        "npcs": [{"name": "Madam Eva", "da": "Spåkone", "en": "Fortune teller", "cites": [first]}],
        "loot": [],
        "threads": [],
        "dice": [],
        "quotes": [{"id": first, "da": "Hej", "en": "Hi"}],
        "gm_only": [{"da": "Hemmelig", "en": "Secret", "cites": [first]}],
    }
    answer.update(overrides)
    return answer


SESSION_ANSWER = {
    "title_da": "Session",
    "title_en": "Session",
    "summary_da": "Resumé.",
    "summary_en": "Summary.",
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
        kind = "scene" if "lines" in schema["properties"] else "session"
        self.calls.append((kind, prompt))
        if self.fail.get(n) == "limit":
            raise UsageLimitError("Claude usage limit reached")
        if self.fail.get(n) == "error":
            raise ClaudeError("boom")
        if kind == "session":
            return dict(SESSION_ANSWER)
        answer = scene_answer(prompt)
        if n in self.bad_lines:
            answer["lines"] = answer["lines"][:-1]  # drop a line: fails the hard check
        return answer
