---
name: lane
description: How a Foundry AI Tool coding lane works from claim to merge - claiming a Backlog item, the worktree and branch, subagent models, keep-green checks, the test server, the PR and its review note, the merge gate, context limits and the handover. Use at the start of any lane session (a session that builds, fixes or tests something and ends in a PR), and again before opening a PR, merging or handing over.
---

# Lane

A lane is one session with one outcome: one Backlog item (or one reviewed fix round), one branch,
one PR. Vault paths below are under `C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\`
(pull before writing, push after).

## Start

1. Pull the vault. Open `Backlog.md`, take the top item with no `claimed:` line that fits your
   brief, write `claimed: <session title> <date>` under it, commit and push the vault.
2. `git branch --show-current` (an app restart resets a worktree to its own branch). New work:
   `git fetch aitool && git checkout --no-track -b claude/<topic> aitool/main`, then `npm ci`.
   Before building on an old base, check `git branch -r --list 'aitool/claude/*'` for the same work.
3. Read only what the item names. Long notes, logs or docs: a Haiku subagent returns a summary.

## Work

- **Subagents:** `model: "sonnet"` for code, tests, scripts and sweeps; `model: "haiku"` for
  reading and simple mechanical edits; Opus only for design. Partition workers by file, lock shared
  contracts first, tell them to write big files in parts of at most about 250 lines per call and
  to keep downloads out of the repo. Workers never build, sync or commit; you integrate.
- **Test server:** load `foundry-test-env`; take the lock (`scripts/test-env/lock.ps1 take`) before
  any live check and release it after. Verify a feature live before calling it done. Standalone
  bridge on test ports: `node packages/mcp-server/dist/standalone.js --port 31514 --control-only`;
  `Get-NetTCPConnection -State Listen -LocalPort 31414,31415,31416` shows nothing else bound.
  Stopping a background task may leave its node child running on Windows: check the PID.
- **Commands over 2 minutes** run in the background (`run_in_background`); never poll in a loop.
  On Windows never call `python3` (Store stub, hangs); use `python`. Bash heredocs drop
  backslashes: write code with `\n` or regex through the Write/Edit tools.
- Review checklist from past incidents: `review-checklist.md` next to this file.

## Before the PR

- Keep green (CLAUDE.md lists the commands; `npm run green` once phase 2 of D-122 lands).
- `changelog.d/<topic>.md` added; lint and em-dash baselines lowered if counts dropped.
- `git status --short`: add explicit paths; no binaries, archives, audio, `.env` or downloads.
- PR description = the handover: what changed, how it was verified (commands, live checks, kit
  report with its `run.gitSha`), what is open, follow-ups.

## Review and merge

- Risky categories (guarded writes, bridge link, write gate, security, Pi scripts, wire contracts):
  an Opus review subagent. Everything else: a Sonnet review subagent. Give it the PR number, the
  head sha and the area; it is read-only and writes the note.
- **Review note format** (the merge gate reads it): vault `Handoff/Reviews <YYYY-MM-DD>/<PR>-review.md`
  (round 2: `<PR>-review-round2.md`) containing a line `Head reviewed: \`<sha>\``and a`## Verdict`section whose first bold text is`**Merge.**`, `**Merge after fixes.**`or`**Do not merge.**`, then findings as H/M/L.
- Fix the findings, push, and send the same reviewer (SendMessage to that subagent) the new head
  for one delta round. Lows may go to the Backlog instead.
- **Merge:** `npm run lane:merge -- <PR>` once phase 2 of D-122 lands (it checks CI on the head
  commit, the review note for that sha, the changelog and drift, and the merge-train counter).
  Until then the planner merges with the same checks by hand. Never chain a merge after a wait:
  read every check first. Don't offer the app's PR Auto-fix.

## Context and handover

- Check `get_usage "self"` (context.tokensUsed) after big steps. Plan the handover at 350k, be out
  by 400k (200k and 250k while weekly usage is above 50%).
- Handover: half a page to vault `Handoff/<lane> prompt <date>.md` and in full in the chat in a
  fenced block: task, state, open PRs, links, done-when, "follow CLAUDE.md". Findings a successor
  needs go in the vault, not side-session notes (archiving a session deletes those).
- Before saying a session can be closed: no background run it owns is still going.
- Never leave a user to-do only in chat: add it to vault `Waiting.md` (what to do, minutes, what it
  settles, a `- due:` line).
