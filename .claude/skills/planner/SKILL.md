---
name: planner
description: The on-demand planner for Foundry AI Tool (replaces the always-on steward, D-122) - answering "what's next", keeping the vault Backlog and Waiting notes, starting and checking lanes (cap 3), recording decisions and holds, the merge train, session cleanup and the weekly usage check. Use when the user asks what to do next, wants lanes started or stopped, makes a scope decision, or asks for the state of the project.
---

# Planner

The planner runs on Opus, on demand, for one outcome (a plan, started lanes, a recorded decision),
then ends; it does not wait for lanes. Vault paths are under
`C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\` (pull first, push after). Dated
history of these rules: vault `Decisions/Decisions log.md`.

## Read the state (measured, never from memory)

- `Backlog.md`, `Waiting.md`, CLAUDE.md "Holds now". The `- progress:` line on a claimed item is
  the lane's ready state; lanes message nobody, so read it on every wake (each lane note, gate exit
  or user message) for every claimed item, inherited lanes included. Never message an idle lane
  above about 150k. A lane that stopped with a handover and no running successor gets one the same
  turn (Sonnet; the brief points at its `Handoff/<lane> prompt <date>.md`; a card if the turn cannot
  start sessions), and the stopped lane is archived before the successor checks out its branch (git
  refuses a branch another worktree holds; if the archive leaves the folder, `git checkout
--detach` there once clean).
- `gh pr list --state open` and the CI of each; main's last runs at start and before each lane
  start: `gh run list --branch main -w ci.yml --event push --status completed -L 15` (the start
  hook prints "main CI red since <sha>"). Red means "Main is red".
- `list_sessions` without `linked` (lanes start their own successors), then `get_usage` with each
  running lane's id (lanes underreport their context) and `"self"` for yours and the plan
  percentages.

## "What's next"

Answer with: the due Waiting items (what, minutes, what it settles), running lanes and open PRs,
and the top Backlog items with a bold recommended pick. Decisions go through the question tool, in
a turn after the answer.

## Backlog upkeep

Each item in `Backlog.md`: `## <size S/M/L> <title>` then `- id: <slug>` (short, lowercase, stable,
never changed or reused: the live board, D-124, links by it), `- board: <area>`, `- done when:`,
`- area:`, `- progress:` (the lane's ready state), optional `- gate:`, `- blocked by:` (`W21` or
`item:<id>`), `- pi: yes` (needs a Pi day and the user's OK), `- source:`, `- touches: path,
folder/`, `- depends on: #380, item:<id>`, and `- claimed:` once a lane takes it. The board's Lanes
zone warns on two lanes touching the same path or a claim before its dependency is done; check
that before starting a lane. Order is priority; G0 critical path first. A speed item's `done when`
names a before and an after number, and the lane puts both in the PR body.
Remove items when merged and add a line to `## Done`; if a go / no-go light in `Board.md` names
the removed id, repoint or drop it. Review lows become S items. Triage `## Captured on the board
(triage)` whenever you update the Backlog (fill `- board:`, `- done when:` and the rest, drop
`- captured:`). The board rewrites `Backlog.md` in place: pull first, keep each item's lines together.

## Starting lanes

- Turn Remote Control on for this session (`set_remote_control` "self" true): the app default is
  off, so lanes do not hold archives, but the planner stays reachable from the phone.
- At most 3 lanes, each owning its own files, one per test server. Respect every hold in CLAUDE.md.
- Brief (half a page): the Backlog item, state, open PRs, links, done-when, "load the `lane`
  skill, follow CLAUDE.md", write your `claude://` link (`get_session "self"`, field `link`) as a
  `- link:` line under your claim, report "ready to merge" as a `- progress:` line on the item and
  message nobody. Work outside this repo (the Pi, another folder) carries its rules (`pi-work`).
- `start_session` takes `model` as a full id (`claude-sonnet-5-5`, `claude-haiku-5-5`,
  `claude-opus-5-5`; the hook refuses a short name): Sonnet for coding, Haiku for read-only or
  mechanical work, Opus only for risky design. Every start, Agent and Workflow `agent()` call sets
  it: an unset model inherits the caller's, so this Opus planner would start Opus lanes. If the app
  refuses a start (automated turn, phone, session started by a session), propose a card.

## Before a planner ends or hands over

The planner ends after its outcome, or at 200k context (out by 250k; lanes in `.claude/worktrees/` get 250k and 300k). Before it stops:

1. Write the handover note (running lanes with session ids and `- progress:` state, open PRs, what
   is next), and start the next planner or leave a copy-paste prompt.
2. Detach every running lane with `mcp__ccd_session_mgmt__detach_session` (their turn-end notes
   stop waking this session and archiving it no longer takes them along; it cannot be undone, and
   the app refuses a session the user placed). The next planner finds them through `list_sessions`
   and the Backlog lines.
3. Only then archive this session (see Session cleanup).

## Decisions and holds

- Full read-back only for scope, gate dates, the Pi and money (CLAUDE.md); each question asks one
  thing. Write the note in `Decisions/` (next D number). Other choices: the question tool, then
  one line in the decisions log.
- A process decision names the number it moves, and a new rule deletes or merges an old one (word
  budget: lane skill under 2,000 words, planner under 1,500).
- A hold the user agrees to goes into CLAUDE.md "Holds now" with scope and end the same turn (edit
  the vault master `repo-docs/CLAUDE.md`, copy it to the main checkout).
- User to-dos go into `Waiting.md`: what to do, minutes, what it settles, a `- due:` line; without
  a date they go under `## Someday`, which the start hook does not print.

## Merges

The planner merges; lanes stop at "ready to merge" (a `- progress:` line with PR, full head sha and
review note path). Once the review says Merge, start main's copy of the gate with `--wait-ci` and
`run_in_background` (command in the `lane` skill, without `--dry-run`), in the lane's clean
worktree: it waits for CI on the head, runs the gate and merges or refuses with the reason; the app
wakes you on exit. Only a `lane:merge: merged #<PR>` line means merged. Exit 0 merged, 1 refused, 3
a check failed, 4 head moved (re-review), 5 timed out.
Merge train: the gate refuses a module, bridge link or guarded-write PR once 4 such merges wait;
then run `npm run live:roundtrip` (plus `live:sweep` when write handlers changed) on main through
the test server lock, and on green `npm run lane:merge -- --train-reset <main sha>`; bisect if red
(`--train` shows the count). Run the roundtrip before any Pi deploy too. Tell the user what merged.

## Main is red

Unblock first, fix properly second (vault `Design/Red main root cause 2026-10-31.md`).

1. **Open the unblock PR within 15 minutes:** **revert the merge that turned main red** (the
   `since` sha in the alert, not simply the newest merge; the user's OK first, one line through the
   question tool), or, when the break is a limit (a bundle or tool-set budget, a ratchet baseline),
   **a one-line temporary limit raise** (no OK) with a Backlog item for the proper fix. It is a
   normal PR through the gate. A flaky red: `gh run rerun <id> --failed`.
2. **No other merges while main is red.** Lanes may keep building and pushing.
3. The proper fix is a normal lane; name the red commit, step and unblock PR in the item's
   `- source:`; tell the user in one line.

## Session cleanup

Archive only when certain: not running, worktree clean and pushed (`git worktree list` first), no
process running from it, no other lane on that branch, no background run it owns still going.
Subagent worktrees (`agent-*`) can hold uncommitted work. Archiving deletes the session's
side-session notes, so anything a successor needs lives in the vault (a lost note: grep
`~/.claude/projects/**/*.jsonl` for a Write with that `file_path`).

## Weekly check

`npm run usage:week` (`--days N`, `--json`) against the targets: about 14% of the weekly limit per
day, plus the weekly-check item's two targets. A rule or tool that does not move them is removed.
On the Saturday after the 07:00 weekly reset run `npm run usage:week -- --write-vault --days 7`
and push vault `Weekly check.md` (the board's Week page).

**`Usage now.md` (the board's usage card):** at each planner start and before each lane start, read
`get_usage "self"` (windows "Weekly · all models", "5-hour limit", optionally "Weekly · <model>")
and run, in any built checkout:

```bash
npm run usage:now -- --weekly <%> --weekly-resets <resetsAt> --five-hour <%> \
  --five-hour-resets <resetsAt> --model sonnet=<%> --model opus=<%>
```

Then push the vault. Leave out a window `get_usage` does not list; the board calls a note older
than 12 hours stale.
