# Review runner (D-127)

Reviews pull requests on the separate API credit instead of the subscription. It exists until the
promotional credit expires on 2026-11-14.

## One-time setup

```bash
npm ci --prefix scripts/review-runner
```

Set `REVIEW_RUNNER_API_KEY` as a user environment variable (Console workspace key, spend limit
$100). The runner reads it, hands it to the SDK child process as `ANTHROPIC_API_KEY` and never
prints, logs or writes it. Do not set `ANTHROPIC_API_KEY` in your own shell (D-066).

## Use

```bash
node scripts/review-runner/run.mjs 523 524 --dry-run   # plan only: model, round, budget, note path
node scripts/review-runner/run.mjs 523                  # one real review
```

| Option                 | Meaning                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--model opus\|sonnet` | Override the D-101 choice (default: Opus when the merge gate calls the PR risky)                                  |
| `--round N`            | Default: the next round after the PR's existing notes. Round 3 and up needs `--allow-round3` (the planner's call) |
| `--delta SHA`          | Small commit after a Merge: SHA is what the last Merge note reviewed. See "Small deltas" below                    |
| `--vault DIR`          | Default `$FOUNDRY_AI_OBSIDIAN_DIR` or `~/Documents/Obsidian/vault`                                                |
| `--ledger FILE`        | Default `~/.review-runner/ledger.jsonl`                                                                           |
| `--no-commit`          | Write the note but do not commit and push the vault                                                               |
| `--max-turns N`        | Agent turn limit per review (default 40)                                                                          |
| `--keep-scratch`       | Keep the scratch worktree for inspection                                                                          |

## What a run does

1. Reads the PR (`gh`), picks the model from the merge gate's risky list, finds the next round.
2. Fetches the head (`aitool`), checks it out in a scratch worktree, writes the diff and the PR
   description next to it.
3. Runs the SDK with the Read, Grep and Glob tools only, no user settings or hooks, and a budget of
   $6 (Opus) or $3 (Sonnet) cut to what is left under the total cap. Risky areas add the matching
   `.claude/agents` checklist to the prompt.
4. Checks the answer with the merge gate's own note parser (one `## Verdict`, the `Head reviewed:`
   line the runner inserts, a known verdict) and writes
   `Handoff/Reviews <date>/<PR>-[opus-]review[-roundN].md`, then commits that path in the vault.
5. The ledger takes a `reserve` line at the full budget before the SDK starts and a `settle` line
   (real cost minus the reserve) after it, so a crash or Ctrl-C leaves the full budget booked.
   Appends the cost (`total_cost_usd`, tokens) to the ledger. At $95 in total no review starts.
   The $95 stop is advisory: the Console's $100 workspace limit is the real backstop, a different
   `--ledger` file starts from zero, and two runs at once each read the total once.

## The head is pinned

The runner reads the PR head sha when it plans, fetches and reviews that exact sha, and asks GitHub
for the head again twice: just before the SDK starts (a moved head stops the run with nothing
booked) and after the answer, before the note is written (a moved head writes no note, so no round
is counted; the cost of that review stays in the ledger because it was spent). Rerun on the new head.

## Small deltas (`--delta`)

After a round that said Merge, a docs-only, test-only or changelog-only commit, or a merge of main
that leaves the PR's own files alone, does not need a full third round:

```bash
node scripts/review-runner/run.mjs 610 --delta <sha the last Merge note reviewed> --dry-run
node scripts/review-runner/run.mjs 610 --delta <sha the last Merge note reviewed>
```

It checks that the PR's latest note says Merge for that sha (and is an Opus note when the PR is
risky, and not itself a small-delta note: deltas do not chain), that no note is malformed and that
the sha is an ancestor of the head, then diffs the sha to the head without rename detection. Small
means every changed file is either the PR's own markdown, test or changelog file (at most 400
changed lines; `.claude/` markdown and test or docs config files do not count) or a file the PR
does not own (it came in with main). `--dry-run` still fetches `aitool`, which moves `FETCH_HEAD`
in your checkout.
Anything touching the PR's own code is refused with the reason: run a normal round (round 3 then
needs the planner's `--allow-round3`). A small delta needs no `--allow-round3`. It writes a short
sha-bound note `<PR>-[opus-]review-roundN.md` that the merge gate accepts like any other; the model
is still the D-101 pick (the gate wants an Opus Merge on a risky PR), at a budget of $0.75 (Sonnet)
or $1.50 (Opus), and the reviewer sees only the change since the reviewed sha.

The reviewer's tools go through a guard that allows Read, Grep and Glob inside the checkout, the
scratch folder and the previous note's folder only. A note containing a token-like string is
refused. The scratch folder holds a copy of the private `CLAUDE.md`; it is deleted after the run
unless `--keep-scratch` is set.

The SDK must report `apiKeySource: ANTHROPIC_API_KEY`; anything else stops the run before any
spend, so it cannot fall back to the subscription login.
