# Session notes writer

The Claude half of the session pipeline: it turns a session's merged timeline into notes in
Danish and English (D-072 layers L1 to L3). It runs Claude through the Claude Code CLI on the
subscription (`claude -p`, D-066); no API key, nothing paid unless the subscription itself.

```text
recording -> transcriber -> session-pipeline -> session-notes (this tool)
 (Discord)    (GPU, local)   (merge, names)      (Claude, subscription)
```

## Use

Needs Python 3.12+ (standard library only) and Claude Code installed and signed in on this PC.

```bash
cd tools/session-notes
python -m session_notes scenes <session>     # show the scene split, no Claude call
python -m session_notes run <session>        # write the notes
```

`<session>` is a session folder, or its name under `FVTT_SESSIONS_DIR` (default
`FoundrySessions` in `FVTT_DATA_DIR`, else `Documents\FoundrySessions`). The folder needs `timeline/timeline.jsonl` from
`voice-stack.ps1 transcribe`; a `names.txt` next to it (the same list the transcriber used for
hotwords) helps Claude spell names right.

| Option             | Default  | Meaning                                                              |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `--scene-model`    | `sonnet` | model for the per-scene calls                                        |
| `--session-model`  | `sonnet` | model for the summary and the player recap                           |
| `--scene-effort`   | `medium` | reasoning effort for the scene calls (low, medium, high, xhigh, max) |
| `--session-effort` | `medium` | reasoning effort for the summary and the recap                       |
| `--workers`        | `3`      | scenes written at the same time                                      |
| `--scene-gap`      | `90`     | seconds of silence that start a new scene                            |
| `--only-scene N`   |          | process one scene (for trying prompt changes)                        |

Exit codes: 0 done, 1 error, 75 paused by a usage limit, 76 incomplete (some scenes could not be
written or have no in-depth notes yet). After a pause or an incomplete run, run the same command
again later; finished scenes are kept in `notes/.work/` and are not redone.

## The current way: one command per session

Until G2 the notes are made by hand (the user, 2026-11-20); the hourly task below is not
registered. `pwsh tools/session-notes/session.ps1 <session-folder-name>` runs the whole chain for
that one session: pull from the Pi (`FVTT_PI_HOST`), consent check, names, transcription (takes
the GPU lock), `run --layers`, publish. It publishes to the test bridge (31514); `-Real` publishes
to the real one and is only for when the user says so. `-DryRun` shows the plan. If it stops
(usage limit, bridge down), run the same command again. It is `auto.ps1 -Session <name> -Port <n>`
underneath, so everything in the next section applies to it. `-Server B` (or `C`) publishes to
that test server's bridge instead of A's: take its lock first and join Foundry there as `Claude` in
a browser tab (without a joined GM the publish says "Foundry is not connected" and waits).

Rehearsal 2026-11-24 (2026-11-08 recording, 971 lines, 13 scenes, test server B): notes with
`--layers` took about 10 minutes in three passes of the same command (8.5 min, 1.5 min, 0.6 min;
Sonnet, medium effort, 3 workers), 530,000 tokens in and 224,000 out over 33 Claude calls. Passes 2
and 3 only finish the characters note. Then publish (seconds), reveal the Recap in the dashboard
(After, Handouts, Reveal next, confirm), and the next `session.ps1` run writes `notes\approved.json`.
Transcription was not rerun (the timeline already existed).

## Automatic runs (not registered until G2)

`auto.ps1` does one pass over the sessions folder: it transcribes finished Discord recordings
(`raw\session.json` present, audio, no timeline yet; names from Foundry when the bridge answers),
writes notes where they are missing and publishes finished notes to the bridge (below). It never
deletes audio (D-097). It does nothing when nothing is due, never runs twice at once (a lock
file), and logs to `<sessions>\auto.log`. Try it with `pwsh tools/session-notes/auto.ps1 -DryRun`.
When a pass cannot do its job it also posts one short line to the GM bot channel (`DISCORD_GM_BOT_CHANNEL_ID`,
else `GAMENIGHT_WATCH_CHANNEL_ID`, in `discord-bot.env`) through `announce.mjs gm-bot`: the notes run paused
(usage limit, or Claude logged out), a session skipped for missing recording consent, a failed transcription, notes run or publish, and notes
published with raw-text scenes. The line names the session folder and the event, never what was said. Each event
is posted once (a paused or failed step once per day), tracked in `<sessions>\.notes-tells.json`; a post that fails
is only logged and tried again on the next pass. `-DryRun` prints what it would post.
With the recorder on the Orange Pi (D-068), set `FVTT_PI_HOST`
(normally `foundry-pi`): the pass first runs `pull.ps1`, which copies finished recordings from the
Pi over SSH, checks every file's SHA-256 and marks them pulled there (the Pi deletes them 7 days
later; see the bot's README). Set `MCP_CONTROL_HOST` to the Pi's Tailscale name so `publish`
reaches the bridge there. A Windows scheduled task runs it every hour and at logon, so the notes are ready by the Monday
after a game night with no clicks (a pass cut short by the usage limit continues the next hour; a
pass missed while the PC was off starts when it is back). Register it once, on the PC that records:
`pwsh tools/session-notes/register-auto.ps1` (`-WhatIf` shows it, `-Remove` takes it away). The task
sees the user environment, not a shell profile: `python`, `claude` and `pwsh` on the user PATH,
`FVTT_SESSIONS_DIR` and the other variables as user environment variables, Docker running for the
transcription. Its output goes to `<sessions>\auto-task.log`.

### Consent comes first (D-097)

Nothing is transcribed, written or published for a session unless **every speaker in
`raw/session.json` has a recorded yes** in `<sessions>\consent.json` (kept on the PC, never in the
repo; keyed by Discord user id). Record each reply under the consent message:

```bash
python -m session_notes consent set <discord user id> yes --name Ann
python -m session_notes consent list
python -m session_notes consent check <session>   # exit 77 and the reason when blocked
```

`consent check` prints the id of every speaker still missing. A "no" passes only once that
speaker's audio track is deleted from the session folder (by hand; this tool never deletes audio).
A recorded answer covers every session, past and future, until it is changed: a later "no" also
blocks sessions whose notes are written but not yet approved (it does not retract what was already
published). A folder without `raw/session.json` (an import, an old test folder) cannot be checked
and stays blocked until it has one with a `tracks` list. Before the first pass on a real sessions
folder, run `pwsh tools/session-notes/auto.ps1 -DryRun` and move test recordings aside: every
folder whose speakers all have a yes is processed. A blocked session shows as "waiting" with the reason in `notes/status.json`, so the After view says
why nothing happened.

## The roster (who plays whom, who is GM)

One hand-kept file, `<sessions>\roster.json` (on the PC, never in the repo), applies to every
recording; the key is the Discord user id, the same one `consent.json` uses:

```json
{
  "gm": "<discord user id>",
  "players": {
    "<discord user id>": { "name": "Anna", "character": "Ilvara", "pronouns": "she/her" }
  }
}
```

`raw/session.json` lists each track with its user id, so the notes run gives Claude the GM line and the
character names without a `speakers.json` edit. A `character` in a session's own `speakers.json`
still wins for that session; the roster's `name` replaces the Discord display name the recorder wrote
there. A broken `roster.json` stops the run with the reason (it is never ignored). `python -m session_notes roster check <session>` lists the speakers
the roster does not know (and says if no GM is named); exit 1 when something is missing.
Changing the roster rewrites the scenes on the next run.

## What it writes

In `<session>/notes/`, for `da` and `en` each:

| File                     | Layer | What                                                                                                                                                                                                           |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transcript.<lang>.md`   | L1    | cleaned transcript by scene; each line has a block anchor `^u000123`; out-of-character talk in italics                                                                                                         |
| `index.<lang>.md`        |       | start page: title, date, GM, who plays whom, five lines, links to every page and to the other language                                                                                                         |
| `scenes.<lang>.md`       | L2    | per scene the same headings in the same order (What happened, Decisions, NPCs met, Open threads, Quotes, GM only), "None" when empty; a scene wholly at the table is a short stub; one timestamp link per line |
| `table.<lang>.md`        | L2    | everything said at the table, not in the game: house rules, proposed, play style, absence, planning, open                                                                                                      |
| `raw.<lang>.md`          |       | the recogniser's text as it came (the same text in both files; no Claude call)                                                                                                                                 |
| `summary.<lang>.md`      | L3    | session summary and "what changed", for the GM                                                                                                                                                                 |
| `recap.player.<lang>.md` | L3    | the players' "previously on" recap, marked as a draft until the GM approves it                                                                                                                                 |

Plus `notes.json` (everything, for later steps) and `audit.jsonl` (calls, checks, fixes, pauses).

The layout is fixed (design "Session notes format", 2026-11-23). Quotes stay in the spoken
language and the English file adds the translation in brackets; name variants are not in the
notes (the names check page has them). With `--layers` the character pages (titled "X, played by Y",
with In the story, Player wishes and GM only) and the worth-remembering page are written in both
languages too.

### The three Danish layers (I-066)

With `--layers`, a run also writes the in-depth notes in Danish only (`raw` is written without
`--layers` now):

| File            | Layer    | What                                                                                                                                             |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `depth.da.md`   | in-depth | per scene a detailed account in beats (who said and did what, rulings, names, numbers said aloud), each beat linked to transcript lines; GM only |
| `summary.da.md` | summary  | the existing summary                                                                                                                             |

The in-depth layer is one more Claude call per scene (`--depth-model`, `--depth-effort`, default
Sonnet at medium), checked (at least one beat, citations of real lines only, not too thin for a
long scene) and cached per scene in `notes/.work/depth-NNN.json`, so a usage limit only pauses.
Until every scene has its in-depth notes the run exits 76 (75 when paused) and `depth.da.md` says
so at the top; `notes.json` gets `layers.depth_complete`. `auto.ps1` runs with `--layers` (the
user's OK 2026-11-14) and counts a session as done only when `layers.depth_complete` is true (notes
written before the layers existed have no `layers` part and stay done), so a pass cut short by the
usage limit finishes the in-depth notes on the next hourly pass. A scene whose in-depth notes fail
the checks on three runs at least 30 minutes apart is accepted without them (`depth.da.md` says
so); to try it again, delete `notes/.work/depth-NNN.json` and `depth-NNN.fail.json`.

### Character and worth-remembering notes

With `--layers`, a run also writes four GM-only files, in Danish and English:
`characters.<lang>.md` (one section per player character: what they revealed, choices, ties to
others, open personal hooks) and `remember.<lang>.md` (facts, names, places, promises, hooks and
table agreements worth keeping, grouped by kind; session 0 talk counts). Every point cites
transcript lines like the scene notes. Each layer is one Claude call for the whole session
(`Options.extras_model` and `extras_effort`, Sonnet at medium); a session too long for one prompt
is split by scene and the parts are merged. Results are cached in
`notes/.work/extra-<layer>-NN.json`, so a rerun or a usage limit only redoes what is missing.
`index.da.md` links both, and `notes.json` gets `characters`, `remember` and
`layers.characters_complete` / `remember_complete` (a missing key counts as done, so older notes
stay done). `publish` adds them as sections to the GM summary page only; they are never in the
player recap.

## Names and facts to check (D-151)

Every run (and `session-notes check <session>`, which makes no Claude call) writes
`notes/Names and facts to check.en.md` and `.da.md`. One entry per uncertain name: a word the
transcriber scored under 0.5 that looks like a name (capitalised in mid-sentence, or close to a name in
`names.txt`; ordinary words are skipped using the pipeline's word lists when the repo is there). Spellings
of one name are merged ("Jor", "Jors"); each entry has the count, up to six timestamp links
`[[transcript.en#^u000270|00:39:38]]` and a suggestion from `names.txt`. A few facts are listed too: the
transcript's character name against `speakers.json`, and a character that `names.txt` does not know.

The reviewer writes after `Answer:` (`Svar:` on the Danish page) the right spelling, `same as X` or `not a
name`, and saves. `ok` on a name means the heard spelling is right. The next run stores the answers in
`name-answers.json` (the first answer to an entry is taken; a later edit of that answer on the page is a
correction and replaces it; the English page wins when the two pages differ; an answer under a heading that
is not on the list is named in the audit log, not applied), puts new names first in
`names.txt`, wrong spellings in `rules.json` (the session pipeline's `--rules` file, so a new transcription
fixes them too), rewrites the transcript lines before Claude sees them and writes again only the scenes where
a line changed. The filled entries stay on the page with a `Status:` line. The character name in a speaker
label is not rewritten, only the text.

## Campaign merge plan (D-151)

`python -m session_notes campaign <session>` runs after a notes run with `--layers` (`auto.ps1` does it
once the notes are done; a failure never holds back the publish). One Claude call on the subscription reads
the worth-remembering layer, the cleaned transcript lines it cites and, when `chat-log.json` is in the
session folder (the Foundry chat log, a list of `{time, who, text}`; `--chat-log` names another file), the
chat log. It proposes pages per NPC, creature, place, thread, the session and the table. The code then
applies the ownership table of the design, so the rules do not depend on the model:

| Kind of fact                   | What the plan does                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spelling of a name             | A page for a name that is not on the confirmed list (`names.txt`, the answers on the check page, the roster's characters) is **held**: it goes to the check page as a name with its transcript links, and the next `campaign` run adds it once someone answers. |
| Stats, items, level, ownership | Never written. With `foundry-facts.json` (`{"Ilvara": {"level": "4"}}`, `--foundry-facts`) a claim from the talk is compared; a difference goes to the check page and the page keeps Foundry's version. Without it the claim stays a hint in the plan.          |
| What happened                  | Timeline lines link to the transcript line (`transcript.en#^u000556`) or carry a chat time. A line citing nothing real is dropped.                                                                                                                              |
| Rulings and house rules        | Every `Table` line is written as _Proposed (Danni confirms)_.                                                                                                                                                                                                   |
| Plans and secrets              | Not an input; never a timeline line.                                                                                                                                                                                                                            |

Output: `notes/campaign-merge.json` (`entries` go straight into `plan-campaign-merge`; `held`, `checks`,
`hints` and `next` explain the rest), `notes/Campaign merge plan.en.md` for a person, and
`campaign-checks.json`, which `check` adds to the check page. Only additions are planned: nothing rewrites or
removes text, merges or renames a page. `plan-campaign-merge` applies additions at once only when the GM's
"apply additions without confirming" switch is on in Foundry (`--switch on` records that in the plan);
otherwise the whole merge is a plan to confirm. The Claude call is cached in `notes/.work/campaign.json`, so
answering a name costs no new call. Exit 75 means a usage limit or a logged-out Claude; run it again.

## Into Foundry (D-087)

```bash
python -m session_notes publish <session>                # the live bridge (port 31414)
python -m session_notes publish <session> --port 31514   # the test bridge
```

`publish` builds three pages from `notes.json` as plain HTML: **Recap**, **GM summary** and
**Scenes**, each with Danish first and English under an "English" heading (the transcript and the
links into it stay on the PC). It stages them once on the bridge (control method `session_notes`;
`FOUNDRY_AI_CONTROL_PORT` sets the port). The bridge keeps them in its vault and, with the switch
"AI Tool: Session notes (writes)" on, puts them into a GM-only journal in the folder "Session
notes" by itself as soon as a GM's Foundry client is connected with writes on, as a change with
Undo in Recent Changes. The Recap waits in the reveal queue for the GM. While Foundry is closed the
bridge needs to know the world: set `FVTT_WORLD` (else the next pass stages it). Each later run
only asks for the status, and once the GM revealed the Recap or pressed "Approve without revealing"
it writes `notes/approved.json` (below). Exit code 3 means "not now, try again later" (the bridge
is not running, or Foundry is closed and no world is set); `--restage` sends the notes again while
they are still only staged.

## Approval, and keeping the audio (D-097)

```bash
python -m session_notes approve <session>   # the GM has read the notes and the recap
```

`approve` writes `notes/approved.json`; `publish` writes the same marker once the GM revealed or
approved the Recap in Foundry. It starts no clock: **the audio is kept** on this PC. Before session 0
each player is asked for a written yes that their own track is kept, also as training data, until
they ask for it to be deleted. Nothing in this tool deletes audio by itself.

The Pi is different: `pull.ps1` deletes a session's copy on the Pi 7 days after this PC pulled it.

`cleanup` is a manual tool for the day you decide to free disk space. It has no default and needs
`--days N`; it lists the sessions approved at least N days ago and, with `--yes`, deletes their
audio only (every audio file, the recorder's `raw/*.rec` packet files and Craig zips). Transcripts,
the timeline, the notes and the recorder's event log stay, and the deleted files are listed in
`notes/audio-deleted.json`. It deletes every speaker's audio in those sessions, so it is not the
way to handle a withdrawal.

### A player withdraws

A "no" is handled by hand; there is no switch in the bot. For each session folder in
`<sessions>\` (`FVTT_SESSIONS_DIR`, default `FoundrySessions` in `FVTT_DATA_DIR`, else `Documents\FoundrySessions`):

1. Find the player's track. The recorder writes one file per speaker, named
   `<n>-<discord username>.ogg` (the converted track) and `raw/<n>-<discord username>.rec` (the
   packets as received). `<n>` is the order in which people first spoke, so it differs per
   session; the name is the Discord username in lower case, with odd characters turned into `_`.
   If the name is not clear, `raw/session.json` lists each track with its file, Discord username,
   display name and user id, and `speakers.json` maps the track name to the player's display name.
2. Delete both audio files, and `transcripts/json/<name>.json`, the speech to text of that track
   (the name without the `<n>-` prefix). A Craig zip (`craig-*.zip`), if there is one, holds every
   speaker's audio in one archive and cannot be split: delete the whole zip.
3. Edit by hand what quotes them. The merged `timeline/timeline.jsonl` and `timeline.md` mix every
   speaker in one file, with the speaker name on each line, and the notes (`notes/*.md`,
   `notes.json`) and the pages already in the Foundry journal and the GM vault retell what they
   said. The recorder's `raw/events.jsonl` and `raw/session.json` hold the username and user id.
   There is no tool for this: remove their lines from the timeline and run
   `python -m session_notes run <session>` again, or edit the notes by hand.
4. If the Pi still has the session (it was not pulled yet, or less than 7 days ago), delete the
   same files there, in `/var/lib/foundry-ai-tool/recordings/<session>/`.

The same applies to any copy you made yourself, for example in a backup or a training data set.

## Speed and cost

Measured on a 5-minute slice of real play (5 speakers, 86 timeline lines, one scene), Sonnet at
the default efforts: 3 minutes, about 65,000 input and 23,500 output tokens for the scene and the
summary together. A 4-hour session is about 25 scenes; with 3 workers expect about half an hour.
It all counts against the subscription's usage limits, which is why a limit pauses the run
instead of failing it.

## How it keeps Claude honest

- The timeline is split into scenes before any call: a new scene after 90 s of silence, long
  scenes cut at their largest pause (at most 15 minutes or 160 lines), short ones merged.
- One `claude -p --json-schema` call per scene with no tools and a short system prompt of our own.
- Every answer is checked: each input line must come back exactly once, in order. The cleaned
  text is a correction, not a rewrite: a line that drifts too far from what was said (word-level
  similarity under 0.4, lines of 5+ words) goes back to the raw text. Citations of unknown lines
  are dropped.
- A failed check is retried once; then the scene is split in two and each half tried once; a half
  that still fails keeps its raw text and is marked in the notes.
- The player recap is told to leave out everything in the scene notes' "GM only" lists. It is still
  only a draft: the GM reads it as a GM-only journal page and reveals it through the handout
  reveal flow before any player sees it.

## Tests

```bash
python -m pytest tools/session-notes      # with pytest installed; uses a fake Claude, no calls
```
