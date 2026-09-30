---
name: session-notes
description: Write the notes for a recorded play session - cleaned transcript, per-scene notes, GM summary and a draft player recap, in Danish and English - from a session folder the voice pipeline produced. Use after a Discord recording when the automatic run did not happen, when a run paused on a usage limit, or when the user asks for session notes, a recap or a transcript clean-up of a recording.
---

# Session notes (manual run)

The normal path is automatic: after `/record stop` the bot converts the audio, the transcriber and
the session pipeline build `timeline/timeline.jsonl`, and a scheduled task runs the notes writer.
Use this skill when that did not happen or stopped half way.

## Steps

1. Find the session folder: the newest `*-discord` folder under `FVTT_SESSIONS_DIR` (default
   `%USERPROFILE%\Documents\FoundrySessions`), unless the user names one.
2. If `timeline/timeline.jsonl` is missing, transcribe first (GPU, takes minutes; run it in the
   background):
   `pwsh scripts/voice-stack.ps1 names <session>` (names list from Foundry, if the test bridge
   or the campaign bridge is reachable), then `pwsh scripts/voice-stack.ps1 transcribe <session>`.
3. Show the scene split: `python -m session_notes scenes <session>` from `tools/session-notes`
   (with `PYTHONPATH=src` when the package is not installed). It makes no Claude calls.
4. Run the writer **in the background** (each scene takes 2 to 4 minutes):
   `python -m session_notes run <session>`. Tell the user it is running and how many scenes there are.
5. When it ends:
   - exit 0: report where the notes are (`<session>/notes/`), how many scenes kept raw text
     (`audit.jsonl`: `scene_fallback`), and show the first lines of `summary.en.md`.
   - exit 75: the subscription usage limit was reached. Nothing is lost; say when to run the same
     command again (the limit message says when it resets).
   - exit 1: show the error from the output and `notes/audit.jsonl`.
6. The player recap (`recap.player.<lang>.md`) is a draft. Never post it to players, Discord or
   Foundry from this skill; the GM approves it first.

## Rules

- Never use `python3` on Windows (it is the Store stub and hangs); use `python`.
- Audio, transcripts and notes stay on the PC: never commit them, never paste player speech into
  the repo, an issue or a PR.
- Do not change the real campaign in Foundry from this skill.
