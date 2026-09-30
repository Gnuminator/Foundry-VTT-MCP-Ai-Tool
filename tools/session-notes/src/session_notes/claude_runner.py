"""Call Claude through the Claude Code CLI on the user's subscription (D-066): no API key.

One call = ``claude -p`` with a JSON schema, no tools, no saved session, and a short system
prompt of our own (the default Claude Code prompt would add about 19,500 tokens per call).
The structured answer comes back in the ``structured_output`` field of the JSON result.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Protocol

SYSTEM_PROMPT = (
    "You turn tabletop role-playing session transcripts into accurate notes. "
    "You never invent events, names or quotes. Answer only through the required output format."
)

_LIMIT = re.compile(r"usage limit|rate limit|limit reached|limit will reset|overloaded|429", re.I)


class ClaudeError(RuntimeError):
    """The call failed; retrying the same input may or may not help."""


class UsageLimitError(ClaudeError):
    """The subscription limit is reached: stop now and resume later."""


class Runner(Protocol):
    def __call__(
        self, prompt: str, schema: dict[str, Any], model: str, effort: str = "low"
    ) -> dict[str, Any]: ...


@dataclass(slots=True)
class CallRecord:
    model: str
    seconds: float
    input_tokens: int
    output_tokens: int


class ClaudeCli:
    """The real runner. ``records`` collects timing and token use for the audit log."""

    def __init__(self, executable: str | None = None, timeout: float = 900.0) -> None:
        exe = executable or shutil.which("claude")
        if not exe:
            raise ClaudeError("The claude CLI was not found on PATH (install Claude Code).")
        self.exe = exe
        self.timeout = timeout
        self.records: list[CallRecord] = []

    def __call__(
        self, prompt: str, schema: dict[str, Any], model: str, effort: str = "low"
    ) -> dict[str, Any]:
        cmd = [
            self.exe,
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(schema, separators=(",", ":")),
            "--tools",
            "",
            "--model",
            model,
            "--effort",
            effort,
            "--no-session-persistence",
            "--system-prompt",
            SYSTEM_PROMPT,
        ]
        try:
            proc = subprocess.run(
                cmd,
                input=prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise ClaudeError(f"claude -p timed out after {self.timeout:.0f} s") from exc
        return self.parse(proc.returncode, proc.stdout, proc.stderr, model)

    def parse(self, code: int, stdout: str, stderr: str, model: str) -> dict[str, Any]:
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            text = (stderr or stdout).strip()[:500]
            if _LIMIT.search(text):
                raise UsageLimitError(text) from None
            raise ClaudeError(f"claude -p exit {code}: {text}") from None
        if data.get("is_error") or data.get("subtype") != "success":
            text = str(data.get("result") or data.get("subtype") or "unknown error")[:500]
            if _LIMIT.search(text) or data.get("api_error_status") == 429:
                raise UsageLimitError(text)
            raise ClaudeError(text)
        out = data.get("structured_output")
        if not isinstance(out, dict):
            raise ClaudeError("claude -p returned no structured output")
        usage = data.get("usage") or {}
        self.records.append(
            CallRecord(
                model=model,
                seconds=round(float(data.get("duration_ms", 0)) / 1000, 1),
                input_tokens=int(usage.get("input_tokens", 0))
                + int(usage.get("cache_creation_input_tokens", 0))
                + int(usage.get("cache_read_input_tokens", 0)),
                output_tokens=int(usage.get("output_tokens", 0)),
            )
        )
        return out
