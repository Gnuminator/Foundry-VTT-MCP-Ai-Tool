---
name: lane
description: How a Foundry AI Tool coding lane works from claim to merge - claiming a Backlog item, the worktree and branch, subagent models, keep-green checks, the test server, the PR and its review note, the merge gate, context limits and the handover. Use at the start of any lane session (a session that builds, fixes or tests something and ends in a PR), and again before opening a PR, merging or handing over.
---

# Lane

A lane is one session with one outcome: one Backlog item, one branch, one PR. Vault paths below are
under `C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\` (pull before writing, push
after).

**Asking the user:** any OK, pick, value or input the lane needs from the user goes through
`AskUserQuestion` in that same turn, recommended option first, each question standing on its own.
Not prose, not only the wrap-up ask, never a message asking the planner to get it (no relay). Pi OKs too.

## Start

**Edit and Write tools only for source files:** no sed, perl, python or heredoc edits of repo files
(`guard-shell-edits.mjs` denies them). `format-on-edit.mjs` runs prettier on a file you edit; Read it again when told.

1. Use `node scripts/backlog.mjs` for every Backlog write (hand edits are refused). `status`, then
   `claim <id> "<session title>" --link <link>` (`get_session "self"`, field `link`). If the item has
   `- touches:` or `- depends on:` lines, look at the board's lane warnings first: another lane on
   the same paths, or an unmerged dependency, means wait or ask the planner. Start the lane in its
   own worktree (the context lines are fixed at session start).
2. `git branch --show-current`. New work:
   `git fetch aitool && git checkout --no-track -b claude/<topic> aitool/main`, then `npm ci`.
3. Read only what the item names. More than about eight files to read goes to an Explore subagent
   (`model: "haiku"`) that returns a summary with file:line; you read only what you edit.

## Work

- **Subagents:** `model: "sonnet"` for code, tests, scripts and sweeps; Opus only for design and
  the one risky-PR review; Haiku suits long notes, logs and read-only sweeps. Partition workers by
  file, lock shared contracts first, big files in parts of about 250 lines.
  Workers never build, sync or commit.
- **Set `model` on every Agent call, Workflow `agent()` call and `start_session`** (unset inherits
  the caller's); `guard-model.mjs` denies one without it (forks, cloud starts and the title-only offer
  are exempt). Agent takes `sonnet`, `haiku`, `opus`; `start_session` a full id (`claude-sonnet-5-5`).
- **Test server:** load `foundry-test-env`; take the lock (`scripts/test-env/lock.ps1 take`) before
  any live check and release it after. Servers A, B, C (same `ai-tool-test` world): check `lock.ps1
status -Server B` (and C), take a free one with `-Server X` and pass it to start, stop, sync and
  status. Kit runs default to B. Verify a feature live
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
  - **Quick checks:** `npm run green -- --quick`. It
    diffs your branch against `aitool/main` and runs, for what you touched: the shared build,
    typecheck and unit tests per package, ESLint, markdownlint and `docs:links`, the node tests of
    changed scripts and hooks, dashboard e2e specs, and for
    dashboard or kit paths the catalogue check, bundle budget and `kit.mjs check`. Screenshots
    (`dashboard-visual`) run on CI only.
  - **Push early, never red:** once the quick checks pass, push and open a draft PR before baselines and review; `gh pr ready` before the gate. A failure already on main
    is named in the PR body (`gh run list --branch main -w ci.yml -L 1`), not guessed at.
  - Code comments never contain `#<number>`. After a tool change run `npm run docs:tools`; lower
    the lint and em-dash baselines when the CI ratchet reports a drop (`npm run lint:ratchet --
--update`).
  - **The full local `npm run green`** only on request or when CI cannot tell (Windows-only
    behaviour, checks CI does not run, CI down); it takes the heavy lock (`node
scripts/heavy-lock.mjs status`). `SKIP_PREPUSH=1 git push ...` skips the em-dash pre-push.
- **Dashboard change (anything under `packages/cogm-dashboard/` or a `package-lock.json` change such
  as a Playwright bump):** full-page shots are not committed (CI uploads them as the artifacts
  `dashboard-page-shots-N`; look there). Only a change to a component with a story moves a story
  baseline: then push the branch, run `npm run visual:baselines -- <branch>` (about 15
  minutes on GitHub; a branch cut before the workflow merged needs `git merge aitool/main` first),
  look at the changed PNGs under `packages/cogm-dashboard/web/visual/__screenshots__/`, commit
  them, push, and only then open the PR. The helper logs to
  `%TEMP%\visual-baselines-<branch>-<6 hex>.log` (printed first). If it writes nothing, read that log. Never copy
  baselines from a failed PR run; re-run after a later change that moves pixels.
- `changelog.d/<topic>.md` added; `git status --short`: add explicit paths; no binaries, archives,
  audio, `.env` or downloads.
- PR description = the handover: what changed, how it was verified (commands, live checks, kit
  report with its `run.gitSha`), what is open, follow-ups. Put a line `Backlog: <id>` (the item's
  `- id:`, several comma separated) in the body: the board shows the open PR on your lane card.
- **`Live check:` line (gate-enforced):** a PR touching `packages/foundry-module/src/` or
  `scripts/pi/remote/` needs one in its description. Module: the run on test server A with real
  dnd5e data. Pi: the ARM64 container run plus `deploy/pi/deployed-state.ps1`. Or why there was none.

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
- **Review note:** save the reviewer's text (findings as H1, M1, L1 with file:line and a fix) to a file, then
  `node scripts/review-note.mjs <PR> --verdict merge|fixes|no --model opus|sonnet --body <file> [--round N]`.
  It names the file, writes the head and verdict lines, checks them with the gate's parser and pushes the vault
  note; it refuses Sonnet on a risky PR. Every note for the head must say Merge.
- **Findings:** fix highs and mediums in one batch, push, wait for CI green on the new head, and
  give the same reviewer one delta check. Lows: when the PR needs a fix round anyway,
  fix them in it; a note with only lows says Merge and each low becomes
  `backlog.mjs low <area> "PR <n> L<k>: <what>, <file>"`. A lows PR
  files no new lows but still gets mediums and highs. A docs-only, test-only or changelog-only commit after a Merge gets a delta note on
  that sha instead of a round 3; a third round for anything else needs the planner. A clean merge
  of main or rebase with the same `git patch-id` needs no new note (the gate carries the verdict).
- **Push:** `git push -u aitool claude/<topic>:claude/<topic>` (explicit refspec, never a bare
  push from a branch made off `aitool/main`). When merging `aitool/main` into the branch, a conflict
  in a generated tools file (`docs/reference/tools*`) is never hand-merged: take either side and rerun
  `npm run docs:tools`.
- **Ready to merge (the merge runner merges, D-140):** once every review for the head says Merge, run
  `backlog.mjs progress <id> --ready <n> --head <40-char sha> --review <note path>`, keep the branch
  pushed and stop; message nobody. The runner gates that head in its own checkout and writes a
  refusal over the line. With the merge queue on, the gate enqueues; a failed queue run needs
  a fresh ready line. Never run the
  gate without `--dry-run`; don't offer Auto-fix. To check
  the gate, from the clean, pushed PR branch, run main's copy (never the branch's own):

  ```bash
  d=$(cygpath -m "$(mktemp -d)") && git fetch -q aitool main && git archive aitool/main scripts/lane-merge.mjs scripts/lane-merge | tar -x -C "$d" && test -s "$d/scripts/lane-merge.mjs" && node "$d/scripts/lane-merge.mjs" <PR> --dry-run
  ```

  (The gate is the entry file plus the folder `scripts/lane-merge/`, so both come out of main together.)

  Only a `lane:merge: OK #<PR>` line passes; anything else (or nothing) is a refusal. The gate checks CI on the head, a review note for that sha, the changelog fragment,
  `drift:check` and the merge train. Exit codes: 0 ok or merged, 1 refused, 2 usage, 3 a check
  failed, 4 head moved, 5 timed out. **Do not pipe the gate through
  `tail` or `head`** (it hides the exit code): run it plain and read its last line. A blocking CANCELLED check of an unclassified or mixed CI
  run (all its jobs cancelled before they started, or both `[dispatch]` and plain names) is not
  cleared by a newer run: rerun it (`gh run rerun <id> --failed`) or push.

## Context and handover

- The context hook prints one line at 250k (plan the handover) and 300k (hand over now) for a
  lane (project dir under `.claude/worktrees/`), fixed at session start (the user, 2026-11-04); the planner and
  other sessions keep 200k and 250k. `get_usage "self"` gives the exact number.
- **Hard stop:** at or above 300k `context-stop.mjs` denies Edit, Write, Agent and shell commands
  that write in the repo. Still allowed: reading, git add, commit and push, `gh`, writes to the
  vault and the scratchpad, SendMessage, wrap_up. Write the handover and stop.
- **Handover:** write it once, when you hand over. Half a page in vault `Handoff/<lane> prompt
  <date>.md` and in the chat in a fenced block: task, state, branch, PR and head sha, done-when, the next command, "follow
  CLAUDE.md". Findings a successor needs go in the vault, not side-session notes (archiving deletes those). Before closing, no background run of yours may still go. Push the note, then `backlog.mjs progress` (`handed over at <context>, no PR
yet` or the PR state, plus the note path); the planner reads it and starts the successor. Start no successor, message nobody.
- Never leave a user to-do only in chat: add it to vault `Waiting.md` (what to do, minutes, what it
  settles, a `- due:` line).
