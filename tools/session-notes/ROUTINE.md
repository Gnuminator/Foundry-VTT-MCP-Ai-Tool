# Recap while the PC is off (I-132)

**Status: parked and unverified.** The inbox flow has not been run end to end. If it is picked up
again, the first fix is the `notes_done` gap: `notes_done` in `src/session_notes/inbox.py` only
checks that `notes/notes.json` exists, so a partly written folder counts as finished.

Off by default. A cloud routine writes the notes from the transcript text while the PC is off.
Audio and transcription stay on the PC. The inbox must be a **private** GitHub repo: it holds
player speech as text, so it never goes into the public repo.

## Flow

1. The PC transcribes as today. With `FVTT_RECAP_INBOX` set to a clone of the private inbox repo,
   each `auto.ps1` pass runs `python -m session_notes inbox sync`: it pulls the inbox, copies
   finished notes back into the session folder, and pushes new timelines (`timeline.jsonl` and
   `names.txt` only, and only when every speaker has a recorded yes, D-097).
2. The routine (below) runs on a schedule, writes notes for each pending session folder in the
   inbox and pushes them.
3. The next PC pass copies the notes in. They then follow the normal path (publish, GM approval).

## One-time setup (the user)

1. Create a private repo, for example `Gnuminator/foundry-recap-inbox`, and clone it. Give it no
   GitHub Actions workflows: the inbox runs nothing on GitHub, so it uses none of the private-repo
   Actions minutes (do not switch on CodeQL or other default Actions setups there). Revoking a
   player's yes means deleting that session's folder from the inbox repo by hand. The routine runs on Anthropic's side and counts against the Claude subscription.
2. Set the user environment variable `FVTT_RECAP_INBOX` to the clone's path.
3. Create the routine at claude.ai/code/routines: repository = the inbox repo, with this tool's
   source added as a second repository (the public repo, `tools/session-notes`), schedule = Monday
   morning (minimum interval one hour), prompt below. Pushing to the inbox repo must be allowed.

## Routine prompt

```text
You write session notes from transcript text. In the inbox repo:
1. Run `python -m session_notes inbox pending` with FVTT_RECAP_INBOX set to the inbox repo path
   and PYTHONPATH set to tools/session-notes/src of the tool repo. It lists session folders
   that still need notes. If none, stop.
2. For each folder, run `python -m session_notes run <folder>` (same PYTHONPATH).
   Exit 0 is done; 75 means a usage limit or a logged-out claude, 76 means run it again once, 77 means no consent for the session, 78 means the scene notes are done but the summary failed (run it again).
3. Commit everything under sessions/ (finished scenes in notes/.work/ may be committed, so a
   stopped run resumes) and push. Do not read, quote or summarise the transcript anywhere else,
   and never copy it into another repository.
4. Report one line per session: done, paused or failed.
```

## First run

Run `python -m session_notes inbox sync` by hand after a transcribed session, trigger the routine
from claude.ai/code/routines (Run now), then run `inbox sync` again and check
`<session>/notes/summary.en.md`. Unverified until that first real run: that `claude -p` works
inside the routine's environment; if it does not, the routine prompt can write the notes itself
from `prompts.py`.
