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
   brief, write `claimed: <session title> <date>` under it and, on the next line,
   `- link: <your session link>` (the `link` field of `get_session "self"`, a `claude://` address;
   the board's lane card opens your session from it), commit and push the vault, then
   `npm run lane:beat -- "<session title>" claimed` (see Heartbeat). If the item
   has `- touches:` or `- depends on:` lines, look at the board's lane warnings first: another lane
   on the same paths, or an unmerged dependency, means wait or ask the planner. If the vault note
   `Usage now.md` is more than about 2 hours old (the planner writes it before starting a lane),
   refresh it from `get_usage "self"` (planner skill, Weekly check).
2. `git branch --show-current` (an app restart resets a worktree to its own branch). New work:
   `git fetch aitool && git checkout --no-track -b claude/<topic> aitool/main`, then `npm ci`.
   Before building on an old base, check `git branch -r --list 'aitool/claude/*'` for the same work.
3. Read only what the item names. Long notes, logs or docs go to a Haiku subagent (list under
   Work); you read its summary.

## Heartbeat

At each milestone write a heartbeat under your claim, so the PM board's lane card shows your step
and how long ago it was, and the stale rule ("no activity for 18 hours") counts it:

```bash
npm run lane:beat -- "<session title>" "<step>"
```

It adds `- last seen: <YYYY-MM-DD HH:MM> <step>` (Copenhagen time) under every claimed item of the
lane, replacing the old line, then fetches, fast-forwards, commits only `Backlog.md` and pushes the
vault; a vault problem is a warning and never stops you (with uncommitted edits in the vault's
`Backlog.md` the beat is skipped with a warning: run it again a minute later). The milestones and their steps: `claimed` (right after
the claim), `PR open`, `review` (review started), `fixes` (a review round came back), `ready to
merge`, `handed over`. Also beat when a long step runs past two hours without any of those
(`still testing`, `waiting for CI`). The board drops the line when the claim is released or the
item is marked done; the board ignores a line on an item with no claim.

## Work

- **Advisor (D-127):** call `advisor` (Opus, the user setting) once before you start coding and
  once before you open the PR; act on it or say in the PR why not. The weekly check counts the
  calls.
- **Subagents:** `model: "sonnet"` for code, tests, scripts and sweeps; `model: "haiku"` for
  reading and simple mechanical edits; Opus only for design and risky-PR reviews. Partition workers
  by file, lock shared contracts first, tell them to write big files in parts of at most about 250
  lines per call and to keep downloads out of the repo. Workers never build, sync or commit; you
  integrate.
- **These steps go to a Haiku 5.5 subagent (`model: "haiku"`), not to you** (D-122 weekly check
  2026-10-17: Haiku had 2 turns in a week; the rule is checked again 2026-10-24):
  - reading a vault note of more than about 100 lines (a Decisions log, a design note, an old
    review or handoff note): ask for the parts your item needs, with line numbers;
  - reading CI and test logs (`gh run view --log-failed`, a long `npm run green` or test output):
    ask for the failing step, the first error and the files it names;
  - summarising a review note, or a PR diff for the handover: findings by ID with file:line;
  - sweeps that only read ("where is X used", listing files that mention Y) and mechanical edits
    that need no judgement (renames, reflowing text, adding a changelog fragment from your text).
    Short files you will edit anyway, and anything where a wrong summary would change your fix, you
    read yourself. Brief it with the question to answer and say it is read-only.
- **Set `model` on every Agent call, Workflow `agent()` call and `start_session`** (successors and
  `own_initiative` cards too). An unset model inherits the caller's: an Opus session starts Opus
  workers and lanes (measured 2026-10-16: 110 unset subagents all ran Opus). A Sonnet lane's unset
  child stays Sonnet, but set it anyway. The hook `.claude/hooks/guard-model.mjs` denies an Agent
  or `start_session` call with no `model` (forks, cloud starts and the title-only offer are exempt).
  Agent takes the aliases `sonnet`, `haiku`, `opus` (also for an agent type whose definition sets a
  model: the call's `model` wins); `start_session` takes a model id (`claude-sonnet-5-5`,
  `claude-haiku-5-5`), and the hook denies an alias there.
- **Test server:** load `foundry-test-env`; take the lock (`scripts/test-env/lock.ps1 take`) before
  any live check and release it after. There are three servers (A, B, C, same `ai-tool-test`
  world): run `lock.ps1 status -Server B` (and C) and take a free one with `-Server X`; use that
  server's ports and pass `-Server X` to start, stop, sync and status. Queue on A only when all
  three are taken. Kit runs default to B. Verify a feature live before calling it done. Standalone
  bridge on test ports: `node packages/mcp-server/dist/standalone.js --port 31514 --control-only`
  (B 31524, C 31534);
  `Get-NetTCPConnection -State Listen -LocalPort 31414,31415,31416` shows nothing else bound.
  Stopping a background task may leave its node child running on Windows: check the PID.
- **Commands over 2 minutes** run in the background (`run_in_background`); never poll in a loop.
  On Windows never call `python3` (Store stub, hangs); use `python`. Bash heredocs drop
  backslashes: write code with `\n` or regex through the Write/Edit tools.
- Review checklist from past incidents: `review-checklist.md` next to this file.
- For dashboard or player-page UI changes the reviewer also checks `docs/dev/UX-REVIEW-LIST.md`
  (forms, contrast, states, keyboard, phone width, pre-delivery steps). Name it in the review brief.

## Before the PR

- `npm run green`: everything CI's build-test job runs, quiet (one OK line, or the failing step
  and its log tail). `--list`, `--only a,b`, `--from <step>` for a rerun. Run it once before the
  first push. **Green on the final commit:** after review fixes, CI green on the PR head counts
  (the merge gate checks it on that exact commit; the user, 2026-10-30), so a second local green is
  only needed when you want the answer before pushing. A full OK run writes
  the tree it ran on (uncommitted edits included) to `.git/green-ok`; the `pre-push` hook
  (`scripts/pre-push.mjs`: the lint and em-dash ratchets and the typecheck, about a minute) is
  skipped when every pushed commit has that tree, and otherwise refuses a push that CI would fail
  on those. `SKIP_PREPUSH=1 git push ...` skips it by hand. Heavy runs share the PC through a
  machine-wide lock: `node scripts/heavy-lock.mjs status` shows who holds it and who waits; the
  slot count is in `~/.foundry-ai-tool/heavy-lock.json` (`{"slots": 3}`), read on every run.
- **Dashboard change (anything under `packages/cogm-dashboard/`, stories included, or a
  `package-lock.json` change such as a Playwright bump):** push the branch, run `npm run visual:baselines -- <branch>` (starts `visual-baselines.yml` on GitHub,
  about 15 minutes, no Docker needed; the workflow runs on your branch, so a branch cut before it
  merged needs `git merge aitool/main` first), look at the changed PNGs it prints under
  `packages/cogm-dashboard/web/visual/__screenshots__/`, commit them, push again, and only then
  open the PR.
  If it stops with "git saw N changed or new PNG(s) in the run but the artifact holds M" or "no png-count.txt marker",
  the collect step lost files (or the branch has an old workflow file: merge `aitool/main`); it
  writes nothing then, so read the run log. A clean run on a branch with one changed screenshot
  delivered that PNG (2026-10-27, run 40595605155).
  Never copy baselines from a failed PR run. Re-run it after a later change that moves pixels.
- `changelog.d/<topic>.md` added; lint and em-dash baselines lowered if counts dropped.
- `git status --short`: add explicit paths; no binaries, archives, audio, `.env` or downloads.
- PR description = the handover: what changed, how it was verified (commands, live checks, kit
  report with its `run.gitSha`), what is open, follow-ups.
- Put a line `Backlog: <id>` (the item's `- id:`, several comma separated) in the PR body: the live
  PM board shows the open PR on your lane card from it.

## Review and merge

- Risky categories (guarded writes, bridge link, write gate, security, Pi scripts, wire contracts,
  the merge gate and CI: `scripts/lane-merge.mjs`, `green.mjs`, `drift-check.mjs`, `.github/`,
  `.claude/hooks/`): an Opus review subagent. Everything else: a Sonnet review subagent (the gate
  decides which, see the next bullet; docs, tests, dashboard UI and kit scripts are usually
  Sonnet, and so is a delta round on lows, for a non-risky PR only: a risky PR's fixes go back to
  its Opus reviewer). Give it the PR number, the head sha and the area; it is read-only and writes
  the note.
- **Pick the reviewer with the gate, before the first review:** once the PR is pushed, run the
  gate's `--dry-run` (command under "Ready to merge" below). If it prints a `risky (...)` line
  ending in "an Opus review is required", the review is Opus, whatever your own reading of the
  file list says (the gate's list is the one that counts: `shared/src/` is wire contracts,
  `scripts/plan-b/` counts as Pi scripts). Its other refusals at this point (no review note yet,
  CI pending) are expected. A Sonnet note on a PR the gate calls risky is wasted: on 2026-10-19
  #435 and #438 each needed a fresh Opus round after two Sonnet rounds.
- **Pre-review agents (I-143):** before the formal review, run the narrow read-only reviewers in
  `.claude/agents/` (`model: "opus"`) on the pushed head, one per kind of change:
  `review-guarded-writes` (guarded writes, write gate, plan/confirm/undo, dashboard buttons that
  call them), `review-wire-contracts` (shared types, bridge methods, tool sets, tool descriptions),
  `review-pi-ci` (Pi scripts, CI, the merge gate). Give each the PR number, the full head sha, the
  path of a `git diff aitool/main...HEAD` file and the PR description, in a checkout at that sha.
  Fix what they find, then brief the formal reviewer with the findings and fixes; they do not
  replace it.
- **Hybrid review flow (D-127):**
  - **Rounds:** every PR gets one review round plus one delta check by the same reviewer (D-101).
    A third round needs the planner; do not start one yourself (the runner refuses it without
    `--allow-round3`, which is the planner's flag). Batch your findings into one fix round.
  - **Instant review:** PRs on the critical path, PRs other work stacks on, and risky PRs (the
    gate's list) are reviewed now while you are alive, by a subagent as above.
  - **Batched review:** low-risk PRs (build-ahead, board, lows, docs) do not wait for you: report
    "PR open" in the `- progress:` line and end. The planner has them reviewed once or twice a day
    by a review lane or by the API runner (next bullet). Fix the findings when they come back.
- **Review runner (D-127, until 2026-11-14):** `node scripts/review-runner/run.mjs <PR>...` reviews
  on the separate API credit, never the subscription. It needs `REVIEW_RUNNER_API_KEY` in the
  environment (only the runner reads it, and it hands it to its SDK child as `ANTHROPIC_API_KEY`;
  never set or print that name in your own shell) and a one-time `npm ci --prefix
scripts/review-runner`. It picks Opus for a PR the gate calls risky and Sonnet otherwise, checks
  the head out in a scratch worktree, writes the note in the format below to vault `Handoff/Reviews
<date>/`, commits it with explicit paths and logs the cost in `~/.review-runner/ledger.jsonl`; it
  stops at $95 in total. `--dry-run` shows the plan and spends nothing. Run it for real only when
  the planner asked.
- **Review note format** (the merge gate reads it):
  - path: vault `Handoff/Reviews <YYYY-MM-DD>/<PR>-review.md`, round 2 `<PR>-review-round2.md`;
    Opus: `<PR>-opus-review.md`, `<PR>-opus-review-round2.md`, with the heading
    `# PR #<PR> Opus review: ...`;
  - a line `Head reviewed: <full 40-character sha>` above each `## Verdict` and none after the last
    one (the gate refuses a note in any other order as malformed);
  - a `## Verdict` section whose first bold text is exactly `**Merge.**`, `**Merge after fixes.**`
    or `**Do not merge.**` (every note for the head must say Merge);
  - findings as H1, M1, L1 with file:line and a fix.
- Fix the findings, push, and send the same reviewer (SendMessage to that subagent) the new head
  for one delta round. Lows may go to the Backlog instead.
- **Push:** `git push -u aitool claude/<topic>:claude/<topic>` (explicit refspec, never a bare
  push from a branch made off `aitool/main`).
- **Ready to merge (the planner merges, 2026-10-16):** once every review for the head says Merge,
  stop: report the PR number, the full head sha and the review note path, and leave the PR open
  and keep the worktree, clean and pushed, until the planner has merged. If no planner is left to
  merge (none active in ListAgents, the `- progress:` line unanswered for a long while), the hold
  ends only when the user says so: ask the user and leave the worktree as it is meanwhile.
  **Report in the vault first (2026-10-23):** write a `- progress:` line on your item in vault
  `Backlog.md` (pull first, then commit and push) carrying the PR number, the full head sha and
  the review note path, plus anything the brief asks for (a tally the brief names, say), as one
  line like `- progress: <date> PR #<n> ready, head <40-char sha>, review <note path>`. Replace
  your earlier line instead of stacking another. That line is the ready state the planner reads;
  a planner that was replaced since your brief never sees a message. Only after the push may you
  SendMessage "the newest session titled Planner", and only if ListAgents shows one active. Never
  message a fixed session id from your brief: a planner that handed over wakes at full price on
  every note and the new one never gets it.
  Don't run the gate without `--dry-run` and don't offer the app's PR Auto-fix. To check the gate
  first, from the PR branch, clean and pushed, run main's copy (never the branch's own, so a PR
  cannot judge itself):

  ```bash
  g=$(cygpath -m "$(mktemp --suffix=.mjs)") && git fetch -q aitool main && git show aitool/main:scripts/lane-merge.mjs > "$g" && test -s "$g" && node "$g" <PR> --dry-run
  ```

  One `&&` chain, so an empty or failed copy never runs. Only a `lane:merge: OK #<PR>` line means
  the checks pass; anything else, or no output, is a refusal. The gate checks CI on the head commit,
  a review note for that sha (Opus for risky paths), the changelog fragment, `drift:check` and the
  merge train. Add `--wait-ci` to wait for CI first; exit codes: 0 ok or merged, 1 refused, 2 usage,
  3 a check failed, 4 head moved, 5 timed out. With `--wait-ci` every run ends with one line
  `lane:merge: wait-ci ended: exit <code>, <reason>` (also after a killed child or an unexpected
  error). **Do not pipe the gate through `tail` or `head`** (the pipe hides its exit code and holds
  all output until the end): run it plain, in the background if it may wait, and read its last line.
  Dashboard-visual is not a required check in the ruleset, but the gate blocks on a red one.

## Context and handover

- The context hook prints one line at 350k (plan the handover) and 400k (hand over now); 200k
  and 250k while the planner has set low mode (weekly usage on or above pace). `get_usage "self"` gives
  the exact number.
- Handover: half a page to vault `Handoff/<lane> prompt <date>.md` and in full in the chat in a
  fenced block: task, state, open PRs, links, done-when, "follow CLAUDE.md". Findings a successor
  needs go in the vault, not side-session notes (archiving a session deletes those).
- Write the `Handoff/<lane> prompt <date>.md` note at the first milestone (green passes, PR
  opened, a review says Merge) and update it at each later one, then commit and push the vault:
  done, left, branch, PR and head sha, the next command. Hitting the limit then means one step.
  At each milestone and at handover also update the `- progress:` line on your Backlog item (same
  rules as under "Ready to merge": vault first, then at most a message to the newest Planner).
- Before saying a session can be closed: no background run it owns is still going.
- Never leave a user to-do only in chat: add it to vault `Waiting.md` (what to do, minutes, what it
  settles, a `- due:` line).
