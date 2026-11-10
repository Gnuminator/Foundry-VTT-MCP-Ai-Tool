---
name: planner
description: The on-demand planner for Foundry AI Tool - answering "what's next", keeping the vault Backlog and Waiting notes, starting and checking lanes (cap 3), recording decisions and holds, the merge train, session cleanup and the weekly usage check. Use when the user asks what to do next, wants lanes started or stopped, makes a scope decision, or asks for the state of the project.
---

# Planner

The planner runs on Opus, on demand, for one outcome (a plan, started lanes, a decision), then
ends (see Waking). Vault paths are under
`C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\` (pull first, push after). History: vault `Decisions/Decisions log.md`.

## Read the state (measured, never from memory)

- `Backlog.md`, `Waiting.md`, CLAUDE.md "Holds now". The `- progress:` line on a claimed item is
  the lane's ready state; lanes message nobody, so read it on every wake for every claimed item,
  inherited lanes included. Never message an idle lane. A lane that stopped with a handover and no
  running successor gets one the same turn (Sonnet; the brief points at its `Handoff/<lane> prompt
<date>.md`; a card if the turn cannot start sessions), and the stopped lane is archived first (git refuses a branch another worktree holds; if the folder stays, `git checkout --detach` there once clean).
- `gh pr list --state open` and the CI of each; main's last runs at start and before each lane
  start: `gh run list --branch main -w ci.yml --event push --status completed -L 15` (red: see Main is red).
- `list_sessions` without `linked` (lanes start their own successors), then `get_usage` with each
  running lane's id (lanes underreport their context) and `"self"` for yours and the plan
  percentages.

## "What's next"

Answer with: due Waiting items (what, minutes, what it settles), running lanes and open PRs, and
the top Backlog items with a bold recommended pick. Decisions go through the question tool, after the answer.

## Backlog upkeep

Each item in `Backlog.md`: `## <size S/M/L> <title>` then `- id: <slug>` (short, lowercase, stable,
never changed or reused: the live board, D-124, links by it), `- board: <area>`, `- done when:`,
`- area:`, `- progress:` (the lane's ready state), optional `- gate:`, `- blocked by:` (`W21` or
`item:<id>`), `- pi: yes` (needs a Pi day and the user's OK), `- source:`, `- touches: path,
folder/`, `- depends on: #380, item:<id>`, and `- claimed:` once a lane takes it. The board's Lanes
zone warns on two lanes on one path or a claim before its dependency is done; check it before a start. Order is priority; G0 critical path first. A speed item's `done when` names a before and after number; the lane puts both in the PR. Remove merged items, add a line to `## Done`, and repoint or drop a `Board.md` light naming the id. Triage `## Captured on the board
(triage)` on each update (fill `- board:`, `- done when:`, drop `- captured:`). The board rewrites
`Backlog.md`: pull first, keep each item's lines together.

## Starting lanes

- Turn Remote Control on for this session (`set_remote_control` "self" true) so the phone reaches it.
- At most 3 lanes, each owning its own files and test server. Respect every hold in CLAUDE.md.
- Brief: the Backlog item, state, open PRs, links, done-when, "load the `lane`
  skill, follow CLAUDE.md", write your `claude://` link (`get_session "self"`, field `link`) as a
  `- link:` line under your claim, report "ready to merge" as a `- progress:` line on the item and
  message nobody. Pi work carries its rules (`pi-work`).
- `start_session` takes `model` as a full id (e.g. `claude-sonnet-5-5`): Sonnet for coding, Haiku for read-only work,
  Opus only for risky design. Every start, Agent and Workflow `agent()` call sets it (unset inherits
  Opus). If the app refuses a start (automated turn, phone, session started by a session), propose a card.

## Before a planner ends or hands over

The planner ends after its outcome. At 200k context it plans the handover and keeps working; it is out by 250k (lanes in `.claude/worktrees/` get 250k and 300k). Before it stops:

1. Write the handover note (running lanes with session ids and `- progress:` state, open PRs, what
   is next), and start the next planner or leave a copy-paste prompt.
2. Detach every running lane with `mcp__ccd_session_mgmt__detach_session` (their notes stop waking
   this session; irreversible; the app refuses one the user placed). The next planner finds them
   through `list_sessions`.
3. Only then archive this session (see Session cleanup).

## Decisions and holds

- Full read-back only for scope, gate dates, the Pi and money (CLAUDE.md); each question asks one
  thing. Write the note in `Decisions/` (next D number). Other choices: the question tool, then
  one line in the decisions log.
- A process decision names the number it moves, and a new rule deletes or merges an old one (word
  budget: lane skill under 2,000 words, planner under 1,500).
- A hold the user agrees to goes into CLAUDE.md "Holds now" with scope and end that turn (edit the
  vault master `repo-docs/CLAUDE.md`, copy to the main checkout).
- User to-dos go into `Waiting.md`: what to do, minutes, what it settles, a `- due:` line (no date: `## Someday`, not printed).

## Waking

While lanes run, end each turn by stopping any old watcher, pushing your vault edits, then starting
`node scripts/planner-wake.mjs` with `run_in_background`, and re-read the Backlog progress lines once
after arming. It exits when a `- progress:` line in vault Backlog.md is new or changed (the output names the item), or after 4 h of quiet (exit 4: re-arm or hand over). Exit 3
(idle over an hour): start a fresh planner (`start_session`, Opus, the printed brief) and end.
Exit 1: tell the user. Stop it on handover. Never poll or wake on a timer.

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
(`--train` shows the count). Run it before any Pi deploy. Tell the user what merged.

## Main is red

Unblock first, fix properly second (vault `Design/Red main root cause 2026-10-31.md`).

1. **Open the unblock PR within 15 minutes:** **revert the merge that turned main red** (the
   alert's `since` sha, not the newest merge; the user's OK first, by question), or, when the break is a limit (a bundle or tool-set budget, a ratchet baseline),
   **a one-line temporary limit raise** (no OK) with a Backlog item for the proper fix. It is a
   normal PR through the gate. A flaky red: `gh run rerun <id> --failed`.
2. **No other merges while main is red.** Lanes may keep building and pushing.
3. The proper fix is a normal lane (red commit, step and unblock PR in `- source:`); tell the user in one line.

## Session cleanup

Archive only when certain: not running, worktree clean and pushed (`git worktree list` first), no
process or background run from it, no other lane on that branch. Subagent worktrees (`agent-*`) can hold uncommitted work. Archiving deletes side-session notes, so a successor's needs live in the vault.

## Weekly check

`npm run usage:week` (`--days N`, `--json`) against the targets, plus the weekly-check item's two
targets. A rule or tool that does not move them is removed. **Pace** is judged by hours worked, not
14% a day: `usage:now` writes `pace-delta` (on pace: within 8 points), `pace-projected-percent` and
`pace-active-hours-left`. Ahead by more than 8: hold new lanes. Projected under 88 (five-hour under
60): offer an extra lane by question, best Thursday or Friday afternoon; no projection, no offer.
The reset is Saturday 06:00 local in winter. On the Saturday after it run `npm run usage:week -- --write-vault --days 7`
and push vault `Weekly check.md` (the board's Week page).
Glance at upstream Actor Studio releases after 2.10.5: a lane rebases it onto our fork,
the module kit passes, then stage 13 installs it.

**`Usage now.md` (the board's usage card):** at each planner start and before each lane start, read
`get_usage "self"` (windows "Weekly · all models", "5-hour limit", optionally "Weekly · <model>")
and run, in any built checkout:

```bash
npm run usage:now -- --weekly <%> --weekly-resets <resetsAt> --five-hour <%> \
  --five-hour-resets <resetsAt> --model sonnet=<%> --model opus=<%>
```

Then push the vault. Leave out an unlisted window; a note over 12 hours old is stale.
