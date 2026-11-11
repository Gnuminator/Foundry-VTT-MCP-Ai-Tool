---
name: lane
description: How a Foundry AI Tool coding lane works from claim to merge - claiming a Backlog item, the worktree and branch, subagent models, keep-green checks, the test server, the PR and its review note, the merge gate, context limits and the handover. Use at the start of any lane session (a session that builds, fixes or tests something and ends in a PR), and again before opening a PR, merging or handing over.
---

# Lane

A lane is one session with one outcome: one Backlog item, one branch, one PR. Vault paths below are
under `C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\` (pull before writing, push
after). History: vault `Decisions/Decisions log.md`.

**Asking the user:** any OK, pick, value or input the lane needs from the user goes through
`AskUserQuestion` in that same turn, recommended option first, each question standing on its own.
Not prose, not only the wrap-up ask, never a message asking the planner to get it (no relay). Pi OKs too.

## Start

**Edit and Write tools only for source files:** no sed, perl, python or heredoc edits of repo files
(`guard-shell-edits.mjs` denies them). `format-on-edit.mjs` runs prettier on a file you edit and
tells you to Read it again when it changed it.

1. Pull the vault. Open `Backlog.md`, take the top item with no `claimed:` line that fits your
   brief, write `claimed: <session title> <date>` under it and, on the next line,
   `- link: <your session link>` (the `link` field of `get_session "self"`, a `claude://` address;
   the board's lane card opens your session from it), commit and push the vault (the board reads
   PR, CI and review state from GitHub; no heartbeat). If the item has
   `- touches:` or `- depends on:` lines, look at the board's lane warnings first: another lane on
   the same paths, or an unmerged dependency, means wait or ask the planner. Start the lane in its
   own worktree: the context lines are fixed at session start, so a session that only `cd`s into a
   worktree later keeps the planner's 200k and 250k lines.
2. `git branch --show-current` (an app restart resets a worktree to its own branch). New work:
   `git fetch aitool && git checkout --no-track -b claude/<topic> aitool/main`, then `npm ci`.
3. Read only what the item names. More than about eight files to read goes to an Explore subagent
   (`model: "haiku"`) that returns a summary with file:line; you read only what you edit.

## Work

- **Advisor:** call `advisor` once, after committing and before the PR; act on it or say in the PR why not.
- **Subagents:** `model: "sonnet"` for code, tests, scripts and sweeps; Opus only for design and
  the one risky-PR review; Haiku suits long notes, logs and read-only sweeps. Partition workers by
  file, lock shared contracts first, big files in parts of about 250 lines.
  Workers never build, sync or commit; you integrate.
- **Set `model` on every Agent call, Workflow `agent()` call and `start_session`** (unset inherits
  the caller's); `guard-model.mjs` denies one without it (forks, cloud starts and the title-only offer
  are exempt). Agent takes `sonnet`, `haiku`, `opus`; `start_session` a full id (`claude-sonnet-5-5`).
- **Test server:** load `foundry-test-env`; take the lock (`scripts/test-env/lock.ps1 take`) before
  any live check and release it after. Servers A, B, C (same `ai-tool-test` world): check `lock.ps1
status -Server B` (and C), take a free one with `-Server X` and pass it to start, stop, sync and
  status. Queue on A only when all three are taken; kit runs default to B. Verify a feature live
  before calling it done. Standalone bridge: `node packages/mcp-server/dist/standalone.js --port
31514 --control-only` (B 31524, C 31534). A stopped background task may leave its node child running: check the PID.
- **Commands over 2 minutes** run in the background, never polled. On Windows never call
  `python3` (Store stub, hangs); use `python`. Bash heredocs drop backslashes: write code with `\n`
  or regex through Write/Edit.
- Review checklist: `review-checklist.md` here. For dashboard or player-page UI the reviewer also
  checks `docs/dev/UX-REVIEW-LIST.md`; name it in the brief.

## Before the PR

- **CI on the PR head is the green.** No full `npm run green` before a PR: quick
  local checks, push, fix what CI reports, also after review fixes. `scripts/lane-merge.mjs --wait-ci` refuses a merge without CI green on the exact head.
  - **Quick checks:** `npm run green -- --quick` (seconds to minutes, no heavy lock). It
    diffs your branch against `aitool/main` and runs, for what you touched: the shared build,
    typecheck and unit tests per package, ESLint, markdownlint and `docs:links`, the node tests of
    changed scripts and hooks, dashboard e2e specs, and for
    dashboard or kit paths the catalogue check, bundle budget and `kit.mjs check`. Screenshots
    (`dashboard-visual`) run on CI only. It never writes `.git/green-ok`.
  - **Push early, never red:** once the quick checks pass, push and open a draft PR before baselines and review; `gh pr ready` before the gate. A failure already on main
    is named in the PR body (`gh run list --branch main -w ci.yml -L 1`), not guessed at.
  - Code comments never contain `#<number>`. After a tool change run `npm run docs:tools`; lower
    the lint and em-dash baselines when the CI ratchet reports a drop (`npm run lint:ratchet --
--update`).
  - **The full local `npm run green`** only on request or when CI cannot tell (Windows-only
    behaviour, checks CI does not run, CI down); it shares the PC through the heavy lock (`node
scripts/heavy-lock.mjs status`). `npm run green -- --cloud` (background) prints one line when
    CI has finished for the pushed HEAD. `SKIP_PREPUSH=1 git push ...` skips the em-dash pre-push.
- **Dashboard change (anything under `packages/cogm-dashboard/` or a `package-lock.json` change such
  as a Playwright bump):** push the branch, run `npm run visual:baselines -- <branch>` (about 15
  minutes on GitHub; a branch cut before the workflow merged needs `git merge aitool/main` first),
  look at the changed PNGs under `packages/cogm-dashboard/web/visual/__screenshots__/`, commit
  them, push, and only then open the PR. The helper takes only its own run (branch, nonce and the
  branch head sha at dispatch) and refuses an artifact from another sha; it logs to
  `%TEMP%\visual-baselines-<branch>-<6 hex>.log` (printed on the first line). If it writes nothing, read that log and the run log. Never copy
  baselines from a failed PR run; re-run after a later change that moves pixels.
- `changelog.d/<topic>.md` added; `git status --short`: add explicit paths; no binaries, archives,
  audio, `.env` or downloads.
- PR description = the handover: what changed, how it was verified (commands, live checks, kit
  report with its `run.gitSha`), what is open, follow-ups. Put a line `Backlog: <id>` (the item's
  `- id:`, several comma separated) in the body: the board shows the open PR on your lane card.

## Review and merge

- **Pick the reviewer with the gate, before the first review:** once the PR is pushed, run the
  gate's `--dry-run` (command below). A `risky (...): an Opus review is required; ...` line (it
  ends with `Opus note for head <sha>: found (...)` or `missing`) means Opus whatever your own
  reading says; its other refusals at this point (no review note,
  CI pending) are expected.
- **One pass:** a risky PR (guarded writes, the write gate, bridge link, security, Pi scripts, wire
  contracts, as the gate decides) gets one Opus pass: a narrow agent in `.claude/agents/`
  (`review-guarded-writes`, `review-wire-contracts`, `review-pi-ci`, `model: "opus"`) or a formal
  Opus review, not both. Everything else gets a Sonnet review plus CI. The reviewer is a read-only
  subagent; give it the PR number, the full head sha, the area, a `git diff aitool/main...HEAD`
  file and the PR description, in a checkout at that sha. A narrow agent cannot write files: save
  its answer unchanged as the note. A note with only lows says **Merge.**
- **Review note format** (the merge gate reads it):
  - path: vault `Handoff/Reviews <YYYY-MM-DD>/<PR>-review.md`, round 2 `<PR>-review-round2.md`;
    Opus: `<PR>-opus-review.md`, `<PR>-opus-review-round2.md`, with the heading
    `# PR #<PR> Opus review: ...`;
  - a line `Head reviewed: <full 40-character sha>` above each `## Verdict` and none after the last
    one (the gate refuses a note in any other order as malformed);
  - a `## Verdict` section whose first bold text is exactly `**Merge.**`, `**Merge after fixes.**`
    or `**Do not merge.**` (every note for the head must say Merge);
  - findings as H1, M1, L1 with file:line and a fix.
- **Findings:** fix highs and mediums in one batch, push, wait for CI green on the new head, and
  give the same reviewer one delta check. Lows are not fixed in the PR: each becomes an S item in
  the Backlog. A docs-only, test-only or changelog-only commit after a Merge gets a delta note on
  that sha instead of a round 3; a third round for anything else needs the planner.
- **Push:** `git push -u aitool claude/<topic>:claude/<topic>` (explicit refspec, never a bare
  push from a branch made off `aitool/main`). When merging `aitool/main` into the branch, a conflict
  in a generated tools file (`docs/reference/tools*`) is never hand-merged: take either side and rerun
  `npm run docs:tools`.
- **Ready to merge (the planner merges):** once every review for the head says Merge, stop and keep
  the worktree clean and pushed until the planner has merged. Pull the vault, then write a
  `- progress:` line on your Backlog item (commit and push), replacing your earlier line:
  `- progress: <date> PR #<n> ready, head <40-char sha>, review <note path>`. That line is the
  ready state the planner reads; do not message the planner. If no planner merges for a long
  while, ask the user and leave the worktree as it is. Don't run the gate without `--dry-run` and
  don't offer the app's PR Auto-fix. To check the gate, from the clean, pushed PR branch, run
  main's copy (never the branch's own, so a PR cannot judge itself):

  ```bash
  g=$(cygpath -m "$(mktemp --suffix=.mjs)") && git fetch -q aitool main && git show aitool/main:scripts/lane-merge.mjs > "$g" && test -s "$g" && node "$g" <PR> --dry-run
  ```

  Only a `lane:merge: OK #<PR>` line means the checks pass; anything else, or no output, is a
  refusal. The gate checks CI on the head, a review note for that sha, the changelog fragment,
  `drift:check` and the merge train. `--wait-ci` waits for CI first; exit codes: 0 ok or merged, 1
  refused, 2 usage, 3 a check failed, 4 head moved, 5 timed out. **Do not pipe the gate through
  `tail` or `head`** (it hides the exit code): run it plain and read its last line. A blocking CANCELLED check of an unclassified or mixed CI
  run (all its jobs cancelled before they started, or both `[dispatch]` and plain names) is not
  cleared by a newer run: rerun it (`gh run rerun <id> --failed`) or push.

## Context and handover

- The context hook prints one line at 250k (plan the handover) and 300k (hand over now) for a
  lane, a session whose project dir (`CLAUDE_PROJECT_DIR`) is under `.claude/worktrees/`, or whose transcript sits in a worktree project folder (`...--claude-worktrees-<name>`; desktop-app worktree sessions have the main checkout as project dir). Both are fixed at session start, so a `cd` does not change it (the user, 2026-11-04); the planner and
  other sessions keep 200k and 250k. `get_usage "self"` gives the exact number. An advisor call's
  top-level usage reads about twice the real context.
- **Hard stop:** at or above 300k `context-stop.mjs` denies Edit, Write, Agent and shell commands
  that write in the repo. Still allowed: reading, git add, commit and push, `gh`, writes to the
  vault and the scratchpad, SendMessage, wrap_up. Write the handover and stop; the deny lifts below the line.
- **Handover:** write it once, when you hand over. Half a page in vault `Handoff/<lane> prompt
  <date>.md` and in full in the chat in
  a fenced block: task, state, branch, PR and head sha, done-when, the next command, "follow
  CLAUDE.md". Findings a successor needs go in the vault, not side-session notes (archiving deletes those). Before closing, no background run of yours may still go. Push the note and a `- progress:` line (`handed over at <context>, no PR
yet` or the PR state, plus the note path); the planner reads it and starts the successor. Start no successor, message nobody.
- Never leave a user to-do only in chat: add it to vault `Waiting.md` (what to do, minutes, what it
  settles, a `- due:` line).
