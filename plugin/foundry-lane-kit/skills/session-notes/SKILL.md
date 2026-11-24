---
name: session-notes
description: Write the notes for a recorded play session - cleaned transcript, per-scene notes, GM summary and a draft player recap, in Danish and English - from a session folder the voice pipeline produced. Use after a Discord recording when the automatic run did not happen, when a run paused on a usage limit, or when the user asks for session notes, a recap or a transcript clean-up of a recording. Also for the campaign pages: the merge plan after a notes run, and adding a pasted Discord message or screenshot to them.
---

# Session notes (manual run)

Until G2 this manual run is the current way (the user, 2026-11-20): the hourly task
(`register-auto.ps1`) is not registered. One entry point does the whole chain for one named
session: pull from the Pi (when `FVTT_PI_HOST` is set), consent check, names, transcribe (takes the
GPU lock itself), `run --layers`, publish. Nothing happens for a session unless every speaker has a
recorded yes (`python -m session_notes consent check <session>`; `consent set <id> yes` records one).

## Steps

1. Find the session folder name: the newest `*-discord` folder under `FVTT_SESSIONS_DIR` (default
   `FoundrySessions` in `FVTT_DATA_DIR`, else `%USERPROFILE%\Documents\FoundrySessions`), or on the
   Pi under `/var/lib/foundry-ai-tool/recordings`, unless the user names one.
2. Run, in the background (it takes a long time: transcription is on the GPU, each scene 2 to 4 minutes):
   `pwsh tools/session-notes/session.ps1 <session>`. It publishes to the **test** bridge (31514)
   unless `-Real` is given; use `-Real` only on the user's word. `-DryRun` shows the plan. The
   output goes to the console and `<sessions>\auto.log`; a final line gives the state from
   `notes\status.json`. Exit 0 means published; anything else: run the same command again (the
   finished steps are kept). The steps below are the pieces, for when one of them needs a look.
3. Pieces. If `timeline/timeline.jsonl` is missing, transcribe first (GPU, takes minutes; run it in the
   background):
   `pwsh scripts/voice-stack.ps1 names <session>` (names list from Foundry, if the test bridge
   or the campaign bridge is reachable), then `pwsh scripts/voice-stack.ps1 transcribe <session>`.
4. Show the scene split: `python -m session_notes scenes <session>` from `tools/session-notes`
   (with `PYTHONPATH=src` when the package is not installed). It makes no Claude calls.
5. Run the writer **in the background** (each scene takes 2 to 4 minutes):
   `python -m session_notes run <session>`. Tell the user it is running and how many scenes there are.
6. When it ends:
   - exit 0: report where the notes are (`<session>/notes/`), how many scenes kept raw text
     (`audit.jsonl`: `scene_fallback`), and show the first lines of `summary.en.md`.
   - exit 75: paused, either the subscription usage limit was reached or `claude` is logged out.
     Nothing is lost; for the limit say when to run the same command again (the message says when
     it resets); for a logout ask the user to log in to `claude`, then run it again.
   - exit 76: some scenes are still raw text. Run the same command again to finish them.
   - exit 1: show the error from the output and `notes/audit.jsonl`.
7. Names check artifact (optional, for a reviewer who wants to listen): `node scripts/names-check.mjs
<session>` builds one card per uncertain name (3 raw lines, the same speaker's cleaned line, a
   ~6 s `.mp4` clip per line from that speaker's own track) plus `sweep.json` (names outside the
   pipeline's list, possible duplicate cards). Read the sweep, add real names with `--candidates`,
   then publish `page.html` as a private artifact with the clips as assets. Details:
   `docs/dev/NAMES-CHECK.md`. The clips hold the friends' voices: private artifact only, never
   commit or post them.
8. Campaign pages (D-151). After the notes run, the session adds to the GM-only Campaign journals:
   - Save the Foundry side into the session folder first (the Claude session does it; both files are
     optional): `get-chat-log` for the session's night, written as `<session>/chat-log.json` (a list of
     `{time, who, text}`), and Foundry's own values for the characters and creatures the talk mentions as
     `<session>/foundry-facts.json` (`{"Ilvara": {"level": "4"}}`; keys `stats`, `items`, `level`,
     `ownership`). Without them the plan still works; claims about stats stay hints.
   - Run `python -m session_notes campaign <session>` (in the background, one Claude call; exit 75 is a
     usage limit or a logged-out `claude`, run it again). It writes `notes/campaign-merge.json`,
     `notes/Campaign merge plan.en.md` and the names and facts for the check page. Pages for
     unconfirmed names are held until someone answers the check page; then run `session_notes check` and
     `campaign` again.
   - Pass the plan's `entries` to `plan-campaign-merge` (prep set). Additions apply at once only when the
     GM's switch is on; otherwise confirm the plan. Details: `tools/session-notes/README.md`.
9. A pasted Discord message or screenshot (paste-to-pages). The bot does not read Discord; the user
   pastes what matters into a Claude session. No session folder and no python: read the paste (an
   image too), build the entries yourself under the same rules, then call `plan-campaign-merge`. The
   label is `Discord, pasted <date>` (today, `YYYY-MM-DD`); it goes in every timeline line's `session`
   field, and a line says who posted it when the paste shows that.
   - **Names:** confirmed only. The confirmed list is the newest session folder's `names.txt`, its
     roster and the answers on its check page, plus the pages that already exist (`search-journals` in
     the Campaign folder). An entry for a name nobody confirmed gets `nameConfirmed: false` (held); tell
     the user which names wait for the check page. Never guess a spelling from the paste.
   - **What happened:** a pasted in-character post is a hint, not the record (the transcript and the
     Foundry chat log own it). Write it as a timeline line that says it came from Discord. It never
     rewrites or contradicts an existing line; a disagreement with a page is told to the user and the
     page keeps its version.
   - **Rulings and house rules:** a ruling in the paste goes in a `table` entry written as "Proposed
     (Danni confirms): ..." (Danish "Foreslået (Danni bekræfter): ..."); only Danni makes it an
     agreement.
   - **Stats, items, level, ownership:** never written (Foundry owns them); name the claim to the user.
   - **Plans and secrets** of the GM are not facts that happened.
   - Append only: no `replaceSummary`, nothing removed or renamed. Danish and English text (game terms
     stay English; quotes stay in the spoken language, with a translation in the English text). Show the
     user the plan (what goes where, what is held) and apply only after the OK, unless the additions
     switch is on and they said go ahead.
10. The player recap (`recap.player.<lang>.md`) is a draft. Never post it to players, Discord or
    Foundry from this skill; the GM approves it first.

## Rules

- Never use `python3` on Windows (it is the Store stub and hangs); use `python`.
- Audio, transcripts and notes stay on the PC: never commit them, never paste player speech into
  the repo, an issue or a PR.
- Do not change the real campaign in Foundry from this skill; publishing to the real bridge
  (`session.ps1 -Real`) only on the user's word.
