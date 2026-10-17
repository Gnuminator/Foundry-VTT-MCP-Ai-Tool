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

Each item in `Backlog.md`: `## <size S/M/L> <title>` then lines `- id: <slug>`, `- board: <area>`,
`- done when: ...`, `- area: <files or folder>`, optional `- gate:`, `- blocked by:`, `- pi: yes`,
`- source:`, and `- claimed:` once a lane takes it. Order is priority; G0 critical path first.
Every new item gets an `- id:` (short, lowercase, stable, never changed or reused, because the
live board at board.spennerit.com, D-124, links items by it) and a `- board:` line (its area on
the board); `- pi: yes` where it needs a Pi day and the user's OK. Write a blocker in `blocked by`
as `W21` for a Waiting item or `item:<id>` for another Backlog item (anything else is free text).
Add `- touches: path, folder/` (what the item writes; a trailing "(about lines 5 to 9)" is ignored) and
`- depends on: #380, item:<id>` (PRs and items that must merge or finish first) where they apply: the board's
Lanes zone warns when two claimed items in different lanes touch the same path (or a folder and a file in it),
and when an item is claimed before what it depends on is done or merged. Check those warnings before starting a lane.
Remove items when merged (the PR is the record) and add a line to `## Done`; if a go / no-go light
in `Board.md` names the removed item's id, repoint or drop that light, because an id no longer on
the Backlog shows as "Check". Lows from reviews become S items. The board's Capture and Promote
(phase 2, live 2026-10-15) add items under `## Captured on the board (triage)` with a
`- captured: <date>` line; triage that chapter whenever you update the Backlog: sort each item into
the chapter where it belongs, fill `- board:` and `- done when:` (and `area`, `blocked by`, size),
then drop its `- captured:` line. The board rewrites `Backlog.md` in place, so pull first and
keep each item's lines together when you move it.

## Starting lanes

- At most 3 lanes, each owning its own files, one per test server. Respect every hold in CLAUDE.md.
- Brief (half a page): the Backlog item, state, open PRs, links, done-when, "load the `lane`
  skill, follow CLAUDE.md". Work outside this repo (the Pi, another folder) carries the rules that
  apply there (`pi-work`).
- `start_session` with `model` set as a full id (`claude-sonnet-5-5`, `claude-haiku-5-5`,
  `claude-opus-5-5`; the hook refuses a short name): Sonnet 5.5 for coding, Haiku 5.5 for read-only
  or simple mechanical work, Opus only for risky design. Every call sets it, `own_initiative` cards and
  successors included: an unset model inherits the caller's, so this Opus planner starts Opus
  lanes (since D-122 two lanes ran Opus that way: the unset cards). Same for the Agent calls and
  Workflow `agent()` calls a planner makes: `model` on each. If the app refuses the start
  (automated turn, phone, session started by a session), propose it as a card and say so.
- The weekly check reads `npm run usage:week`: its Models line must show Sonnet with more turns
  than Opus (turns, not cost: the line is sorted by cost, so Sonnet can be listed second and still
  pass) in a window that starts after 2026-10-12; a window reaching before that will not pass
  (every session ran Opus until 2026-10-10). Read the Opus main turns against the planner and user
  chats of the week: a planner or a user chat on Opus is fine, a lane is not.
- **These planner steps go to a Haiku 5.5 subagent (`model: "haiku"`)**, read-only, with the
  question to answer: reading a long vault note (a Decisions log, a design or handoff note of more
  than about 100 lines), reading CI and test logs (`gh run view --log-failed`), and summarising a
  review note (verdict, head sha, findings by ID) before a merge. Lanes do the same (lane skill,
  Work). The weekly check counts Haiku turns on the Models line: near zero two weeks running
  (checked 2026-10-17: 2 turns) means the rule is not followed or not worth having.

## Decisions and holds

- Full read-back (one OK for the list "you chose X, recorded as Y, starts when Z") only for scope,
  gate dates, the Pi and money; each question asks one thing. Write the note in `Decisions/`
  (next D number). Other choices: the question tool, then one line in the decisions log.
- A hold or pause the user agrees to goes into CLAUDE.md "Holds now" with scope and end the same
  turn (edit the vault master `repo-docs/CLAUDE.md`, copy it to the main checkout).
- User to-dos go into `Waiting.md`: what to do, minutes, what it settles, a `- due:` line. Remove
  them when done.

## Merges

The planner merges (the user, 2026-10-16); lanes stop at "ready to merge" with the PR number, head
sha and review note. Once the review says Merge, start main's copy of the gate with
`--wait-ci` and `run_in_background` (command in the `lane` skill, without `--dry-run`), run in the
lane's worktree (the gate needs the PR head checked out and clean): one process waits for CI on the
head, then runs the gate (review note for that sha, changelog, drift, merge train) and merges or
refuses with the reason; the app wakes you when it exits. Only a `lane:merge: merged #<PR>` line
means merged. Exit 0 merged, 1 refused, 3 a check failed, 4 head moved (re-review the new head), 5
timed out.
Merge train: the gate refuses a module, bridge link or guarded-write PR once 4 such merges wait;
then run `npm run live:roundtrip` (plus `live:sweep`
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

`npm run usage:week` (`--days N`, `--json`) against the D-122 targets: startup 75k or less
(Claude Desktop's floor), 18M tokens or less per merged PR, about 15 sessions a day, about 14% of
the weekly limit per day. The startup share (Share column) is information only: its 20% target was
dropped on 2026-10-17 because the 350k/400k hand-over rule makes it unreachable. First check
2026-10-17, next 2026-10-24. A rule or tool that does not move them is removed.
While weekly usage is above 50%, write `~/.foundry-ai-tool/context-thresholds.json` as
`{ "plan": 200000, "out": 250000 }` (the context hook's low mode); delete it below 50%.
