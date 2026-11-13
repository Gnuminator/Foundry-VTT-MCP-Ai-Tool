---
name: planner
description: The on-demand planner for Foundry AI Tool - answering "what's next", keeping the vault Backlog and Waiting notes, starting and checking lanes, recording decisions and holds, the merge train, session cleanup and the weekly usage check. Use when the user asks what to do next, wants lanes started or stopped, makes a scope decision, or asks for the state of the project.
---

# Planner

The planner runs on Opus, on demand, for one outcome, then ends (D-141, see Ending). Vault paths are under
`C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\` (pull first, push after). History: vault `Decisions/Decisions log.md`.

## Read the state (measured)

- `node scripts/backlog.mjs status --planner` (claims and progress lines, open PRs with CI and review verdict, the merge train,
  main's CI, due Waiting), then `Waiting.md` and CLAUDE.md "Holds now". Lanes message nobody and the merge runner merges, so
  read every progress line once, inherited lanes included. Message a lane only when it has been idle under 55 minutes. A lane
  that stopped with a handover and no running successor gets one (Sonnet; the brief points at its `Handoff/<lane> prompt <date>.md`;
  a card if sessions cannot start); archive the stopped lane first (if the folder stays, `git checkout --detach` there once clean).
- Main red: see Main is red. `list_sessions` without `linked` shows who runs; `get_usage` with each running lane's id (lanes
  underreport) and `"self"` for the plan percentages.

## "What's next"

Answer with: due Waiting items (what, minutes, what it settles), running lanes and open PRs, and
the top Backlog items with a bold recommended pick.

## Backlog upkeep

Use `node scripts/backlog.mjs` (`add`, `done <id> <PR> --sha --pi-run`, `claim`, `progress`,
`release`, `low`; format in the file's preamble): it pulls, edits one item, checks and pushes.
`done` writes the `Backlog done.md` line. Reorder and triage by hand: pull first, keep each item's
lines together. The board's Lanes zone warns on two lanes on one path or a claim before its dependency is done; check it before a start. Order is priority; G0 critical path first. A speed item's `done when` names before and after numbers for the PR. When an item leaves, repoint or drop a `Board.md` light naming the id. Triage `## Captured on the board
(triage)` on each update (fill `- board:`, `- done when:`, drop `- captured:`).

## Starting lanes

- Turn Remote Control on for this session (`set_remote_control` "self" true) for the phone.
- Lows: one sweep lane per area when `Lows/<area>.md` passes about 10 lines; drop lines older than a month.
- Each lane owns its own files and test server. Respect every hold in CLAUDE.md.
- Brief: the Backlog item, state, open PRs, links, done-when, "load the `lane`
  skill, follow CLAUDE.md", claim and report "ready to merge" through `backlog.mjs`, message nobody, ask the user through `AskUserQuestion`, never through the planner. Pi work carries `pi-work`.
- `start_session` takes `model` as a full id (e.g. `claude-sonnet-5-5`): Sonnet for coding, Haiku for read-only work,
  Opus only for risky design. Every start, Agent and Workflow `agent()` call sets it (unset inherits
  Opus). If the app refuses a start (automated turn, phone, session started by a session), propose a card.

## Ending

The planner ends after its outcome: no successor, no handover note. Before it stops it detaches
every lane it started (`mcp__ccd_session_mgmt__detach_session`; irreversible; the app refuses one
the user placed), pushes the vault and archives itself (see Session cleanup).

## Decisions and holds

- Full read-back only for scope, gate dates, the Pi and money (CLAUDE.md). Write the note in `Decisions/` (next D number). Other choices: the question tool, then
  one line in the decisions log.
- A process decision names the number it moves, and a new rule deletes or merges an old one (word
  budget, checked by `scripts/backlog.test.mjs`: lane skill under 1,889 words, planner under 1,190).
- A hold the user agrees to goes into CLAUDE.md "Holds now" with scope and end that turn (edit the
  vault master `repo-docs/CLAUDE.md`, copy to the main checkout).
- User to-dos go into `Waiting.md`: what to do, minutes, what it settles, a `- due:` line (no date: `## Someday`, not printed).

## Train

The merge runner (`scripts/merge-runner.mjs`, D-140) merges ready lines and posts refusals and
stops in #pr-log. At "merge train full" (4 module, bridge link or guarded-write merges): run
`npm run live:roundtrip` (plus `live:sweep` when write handlers changed) on main through the test
server lock, on green `npm run lane:merge -- --train-reset <main sha>`, bisect if red (`--train`
shows the count), then start the runner again (`Start-ScheduledTask 'Foundry AI Tool merge runner'`).
Run it before any Pi deploy.

## Main is red

Unblock first, fix properly second (vault `Design/Red main root cause 2026-10-31.md`).

1. **Open the unblock PR within 15 minutes:** **revert the merge that turned main red** (the
   alert's `since` sha, not the newest merge; the user's OK first, by question), or, when the break is a limit (a bundle or tool-set budget, a ratchet baseline),
   **a one-line temporary limit raise** (no OK) with a Backlog item for the proper fix. It is a
   normal PR through the gate. The `Main red revert` workflow reruns a red once, then opens a draft
   `auto-revert/<sha>` PR (close and reopen it to start CI); the user's OK first, then use or close it.
2. **No other merges while main is red.** Lanes may keep building and pushing. The runner has
   stopped: merge the unblock PR with main's gate (`--wait-ci`) in that PR's own built worktree (never `-gate`, the runner's), then start the runner.
3. The proper fix is a normal lane (red commit, step and unblock PR in `- source:`); tell the user in one line.

## Session cleanup

Archive only when certain: not running, worktree clean and pushed (`git worktree list` first), no
process or background run from it, no other lane on that branch. Subagent worktrees (`agent-*`) can hold uncommitted work. Archiving deletes side-session notes.

## Weekly check

`npm run usage:week` (`--days N`, `--json`) against the targets, plus the weekly-check item's two
targets. A rule or tool that moves neither is removed. **Pace** is judged by hours worked, not
14% a day: `usage:now` writes `pace-delta` (on pace: within 8 points), `pace-projected-percent` and
`pace-active-hours-left`. Pace is information only: it never holds or adds a lane.
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
