# Project dashboard

A developer page for this repo's Claude Code lanes (D-103): which sessions are alive, how full each
context is, who holds the test server, which PRs are red and how much of the plan is used. It runs
on this PC only, on `127.0.0.1:3200`. It is not part of the product: not in the co-GM dashboard, the
installer or the Pi.

```bash
npm run project-dashboard              # serve the page on http://127.0.0.1:3200
npm run project-dashboard -- --lanes   # print the lanes table (10 rows; --lanes 20 for more)
npm run project-dashboard -- --snapshot  # scan once, write snapshot.json, print its path
```

Node 22, no dependencies beyond Node's own modules.

## Data

Everything the page keeps lives in `%USERPROFILE%\.foundry-ai-tool\project-dashboard\` (override:
`PROJECT_DASHBOARD_DATA`), never in the repo or the vault. Not under `%APPDATA%`: the Claude desktop
app is a packaged (MSIX) app, and files its sessions create under AppData land in the app's private
copy, where a server started from a normal terminal cannot see them.

| File                  | Written by            | Holds                                                                            |
| --------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `snapshot.json`       | the scanner           | the page's whole state (schema below); the contract the steward and hooks read   |
| `scan-state.json`     | the scanner           | byte offsets and per-file totals, so each scan reads only new lines              |
| `plan.json`           | the plan meter plugin | the 5-hour and weekly % with reset times, after every turn of any session        |
| `get-usage-plan.json` | a session, by hand    | the `plan` object of the `get_usage` tool (only the Fable weekly meter needs it) |

The test server lock is `lock.json` in the test environment's root (`C:\FoundryTest` by default),
written only by `scripts/test-env/lock.ps1`.

## Secrets and campaign text

Transcripts hold prompts, tool output and possibly secrets. The scanner keeps only these keys of a
transcript record: `timestamp`, `sessionId`, `customTitle`, `type`, `isSidechain`, `cwd`,
`gitBranch`, `message.id`, `message.model` and the numeric fields of `message.usage`; of a subagent
`.meta.json` only `model`; of `~/.claude/sessions/<pid>.json` only `pid`, `sessionId`, `cwd`,
`name`, `status`, `updatedAt`, `hostSessionId` and `startedAt` (never the `.key` files). Lines
without `"type":"assistant"` or `"customTitle"` are not parsed at all; only their timestamp is
read. The whitelist test (`test/whitelist.test.mjs`) asserts that a snapshot holds no key outside
the snapshot schema and no string over 200 characters.

## Snapshot schema (version 1)

```text
{
  version: 1,
  generatedAt: ISO,
  project: { slug, root },                       // transcript folder prefix, main checkout path
  warnings: [string],                            // e.g. "sessions format changed"
  lanes: {
    rows: [LaneRow],                             // newest activity first, CLOSED ones included
    cap: { used, max: 3, steward: sessionId|null },
  },
  usage: { days: [{ date: "YYYY-MM-DD", main: Tokens, sub: Tokens }] },   // this week, local dates
  plan: { source: "plugin"|"get_usage"|null, asOf: ISO|null,
          windows: [{ kind, label, percentUsed, resetsAt }] },
  lock: { state: "no-script"|"free"|"held"|"unreadable", holder, session, since, purpose,
          old,                                   // over 4 hours: maybe a crashed session
          queue: [{ holder, session, since, purpose, old }] },
  prs: { asOf, error, items: [PrItem], mainRuns: [RunItem] },
}

LaneRow = { sessionId, hostSessionId|null, title, closed: bool,
            state: "busy"|"waiting"|"stale", pid|null,
            lastActivity: ISO, lastRequest: ISO|null,
            context, peak,                       // tokens of the last / largest main-chain request
            level: "ok"|"amber"|"red",           // amber from 200k, red from 250k
            doNotReuse: bool,                    // idle over an hour above 150k
            cacheColdAt: ISO|null, cacheMinutesLeft: number|null,   // waiting rows only
            model|null, branch|null, worktree|null, pr: number|null }
Tokens = { input, output, cacheRead, cacheWrite }
PrItem = { number, title, state, draft, branch, headSha, updatedAt, url,
           checks: { pass, fail, pending, failing: [name] } }
RunItem = { workflow, title, status, conclusion, headSha, createdAt }
```

States: **busy** when the session process is live and says busy and the session was active in the
last 30 minutes (a crashed session's file can say busy forever once Windows reuses its pid);
**waiting** when it is live and idle under an hour; **stale** when idle an hour or more, or when the process is gone. The lane cap counts
sessions not titled "CLOSED ..." with activity in the last hour, minus the steward (the session
titled "... fixes and stewardship").

## Files

| File              | Does                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `cli.mjs`         | entry point: serve, `--lanes`, `--snapshot`                             |
| `paths.mjs`       | data folder, Claude folders, project slug, test environment root        |
| `transcripts.mjs` | incremental transcript scan (byte offsets, restart when a file shrinks) |
| `sessions.mjs`    | live sessions from `~/.claude/sessions`                                 |
| `lanes.mjs`       | lane rows, states, alarm levels, cache countdown, lane cap              |
| `gh.mjs`          | PRs and CI through `gh` (every 60 s, only while the page is open)       |
| `plan.mjs`        | plan gauges from `plan.json` and `get-usage-plan.json`                  |
| `lock.mjs`        | reads the test server lock                                              |
| `snapshot.mjs`    | builds and writes `snapshot.json`; `assertWhitelisted`                  |
| `server.mjs`      | the page server: `127.0.0.1:3200`, rejects any other `Host` header      |
| `page/`           | the page (HTML, CSS, JS; no build step)                                 |
| `plan-meter/`     | the Claude Code plugin that writes `plan.json`                          |
