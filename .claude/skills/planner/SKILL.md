---
name: planner
description: The on-demand planner for Foundry AI Tool (replaces the always-on steward, D-122) - answering "what's next", keeping the vault Backlog and Waiting notes, starting and checking lanes (cap 3), recording decisions and holds, the merge train, session cleanup and the weekly usage check. Use when the user asks what to do next, wants lanes started or stopped, makes a scope decision, or asks for the state of the project.
---

# Planner

The planner runs on Opus, on demand, for one outcome (a plan, a set of started lanes, a recorded
decision), then ends. It does not sit and wait for lanes. Vault paths below are under
`C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\` (pull first, push after).

## Read the state (measured, never from memory)

- `Backlog.md`, `Waiting.md`, CLAUDE.md "Holds now".
- `gh pr list --state open` and the CI of each.
- `list_sessions` without `linked` (lanes start their own successors; they only show in the full
  list), then `get_usage` with each running lane's id (lanes underreport their context).
  `get_usage "self"` for your own context and the plan percentages.

## "What's next"

Answer with: the due Waiting items (what, minutes, what it settles), running lanes and open PRs,
and the top Backlog items with a bold recommended pick. Decisions go through the question tool, in
a turn after the answer.

## Backlog upkeep

Each item in `Backlog.md`: `## <size S/M/L> <title>` then lines `- done when: ...`,
`- area: <files or folder>`, optional `- gate:`, `- blocked by:`, `- source:`, and `- claimed:`
once a lane takes it. Order is priority; G0 critical path first. Remove items when merged (the PR
is the record). Lows from reviews become S items.

## Starting lanes

- At most 3 lanes, each owning its own files, one per test server. Respect every hold in CLAUDE.md.
- Brief (half a page): the Backlog item, state, open PRs, links, done-when, "load the `lane`
  skill, follow CLAUDE.md". Work outside this repo (the Pi, another folder) carries the rules that
  apply there (`pi-work`).
- `start_session` with `model` set: Sonnet 5.5 for coding, Haiku 5.5 for read-only or simple
  mechanical work, Opus only for risky design. If the app refuses the start (automated turn,
  phone, session started by a session), propose it as a card and say so.

## Decisions and holds

- Full read-back (one OK for the list "you chose X, recorded as Y, starts when Z") only for scope,
  gate dates, the Pi and money; each question asks one thing. Write the note in `Decisions/`
  (next D number). Other choices: the question tool, then one line in the decisions log.
- A hold or pause the user agrees to goes into CLAUDE.md "Holds now" with scope and end the same
  turn (edit the vault master `repo-docs/CLAUDE.md`, copy it to the main checkout).
- User to-dos go into `Waiting.md`: what to do, minutes, what it settles, a `- due:` line. Remove
  them when done.

## Merges

Lanes merge their own PRs through `npm run lane:merge -- <PR>` (CI on the head commit, review note
for that sha, changelog, drift, merge train). Merge train: the gate refuses a module, bridge link
or guarded-write PR once 4 such merges wait; then run `npm run live:roundtrip` (plus `live:sweep`
when write handlers changed) on main through the test server lock, and on green
`npm run lane:merge -- --train-reset <main sha>`; bisect if red. `--train` shows the count. Run
the roundtrip before any Pi deploy too. Tell the user what was merged.

## Session cleanup

- A handed-over session: rename it "CLOSED (handed over <date>) <title>" once its successor runs
  and nothing runs in it. Never call a session closable while a background run it owns is going.
- Archive only when certain: not running, worktree clean and pushed (`git worktree list` first),
  no process running from the worktree, no other lane on that branch. Subagent worktrees
  (`agent-*`) can hold a lane's uncommitted work. Archiving deletes the session's side-session
  notes, so anything a successor needs lives in the vault. To recover a lost note, grep
  `~/.claude/projects/**/*.jsonl` (subagents too) for a Write with that `file_path`.

## Weekly check

`npm run usage:week` (`--days N`, `--json`) against the D-122 targets: startup 45k or less, startup
share under 20%, 18M tokens or less per merged PR, about 15 sessions a day, about 14% of the
weekly limit per day. First check 2026-10-17. A rule or tool that does not move them is removed.
While weekly usage is above 50%, write `~/.foundry-ai-tool/context-thresholds.json` as
`{ "plan": 200000, "out": 250000 }` (the context hook's low mode); delete it below 50%.
