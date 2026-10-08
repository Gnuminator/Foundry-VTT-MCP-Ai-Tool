# Project dashboard

A developer page for this repo's Claude Code lanes (D-103): which sessions are alive, how full each
context is, who holds the test server, which PRs are red and how much of the plan is used. It runs
on this PC only, on `127.0.0.1:3200`. It is not part of the product: not in the co-GM dashboard, the
installer or the Pi.

```bash
npm run project-dashboard              # serve the page on http://127.0.0.1:3200
npm run project-dashboard -- --lanes   # print the lanes table (10 rows; --lanes 20 for more)
npm run project-dashboard -- --snapshot  # scan once, write snapshot.json, print its path
npm run project-dashboard -- --versions  # print the versions table (--refresh reads the Pi and online now)
npm run project-dashboard -- --usage-log # update the measured Usage rows and push the two notes now
npm run vault:sync -- push -m "message" <path in the vault>...   # the vault wrapper (below)
```

While it serves the page, the server also works in the background every 5 minutes, whether the
page is open or not: it updates the measured Usage rows, refreshes the versions when due and pushes
the two Usage notes to the vault when they changed (at most once an hour).

Node 22, no dependencies beyond Node's own modules.

## Data

Everything the page keeps lives in `%USERPROFILE%\.foundry-ai-tool\project-dashboard\` (override:
`PROJECT_DASHBOARD_DATA`), never in the repo or the vault. Not under `%APPDATA%`: the Claude desktop
app is a packaged (MSIX) app, and files its sessions create under AppData land in the app's private
copy, where a server started from a normal terminal cannot see them.

| File                  | Written by            | Holds                                                                               |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `snapshot.json`       | the scanner           | the page's whole state (schema below); the contract the steward and hooks read      |
| `scan-state.json`     | the scanner           | byte offsets and per-file totals, so each scan reads only new lines                 |
| `plan.json`           | the plan meter plugin | the 5-hour and weekly % with reset times, after every turn of any session           |
| `get-usage-plan.json` | a session, by hand    | the `plan` object of the `get_usage` tool (only the Fable weekly meter needs it)    |
| `usage-log.json`      | the server            | measured Usage rows, plan readings of the last 3 days, weekly summaries, push state |
| `versions-cache.json` | the server            | the last Pi read and the last online check, each with its time                      |

The test server lock is `lock.json` in the test environment's root (`C:\FoundryTest` by default),
written only by `scripts/test-env/lock.ps1`.

## Step 2: versions, measured Usage rows, vault wrapper, watchdog (D-102, D-103)

**Versions.** Foundry, dnd5e and every module: installed on the PC test server (`<test root>/app/package.json`,
`data/Data/systems/*/system.json`, `data/Data/modules/*/module.json`), installed on the Orange Pi and
the newest online. The Pi read is one fixed, read-only command, nothing interpolated, killed after
15 s: `ssh -o BatchMode=yes -o ConnectTimeout=5 foundry-pi cat /opt/foundry/package.json
/var/lib/foundry/Data/systems/dnd5e/system.json /var/lib/foundry/Data/modules/*/module.json` (the
Pi rule in CLAUDE.md allows read-only commands; nothing else runs on the Pi). Newest: Foundry from
its release page (newest stable, plus a newer testing or development release when there is one),
dnd5e from its GitHub releases, each module from its manifest URL. The Pi and the online check run
at most every 6 hours (a failed Pi read is tried again after 30 minutes); the PC read runs on every
snapshot. Only ids, titles, versions and the minimum Foundry version are kept.

**Measured Usage rows** (`usage-log.mjs`). A start row is a session's first main-thread request;
an end row comes when the session is renamed "CLOSED ...", or, provisional, when its process is
gone and it was idle an hour (the row goes away again if the session comes back). Context and peak
are measured from the transcripts; plan % is the plan reading nearest the event (blank when none
lies within an hour). The note column is the session title. Rows start at local midnight of the
day the page first ran. The weekly summary covers one plan week (from the weekly reset): sessions,
peaks over 200k and 250k, tokens by main thread and subagents, tokens per day, the last weekly %.
Both notes go to the vault (`Dev/Foundry AI Tool/Usage log (measured).md` and `Usage weekly
(measured).md`); each PC rewrites only its own `## PC <name>` section. Vault folder:
`PROJECT_DASHBOARD_VAULT`, else `FOUNDRY_AI_OBSIDIAN_DIR`, else `~/Documents/Obsidian/vault`;
`PROJECT_DASHBOARD_VAULT=off` turns the writes off.

**Vault wrapper** (`vault.mjs`, D-102 line 8). `npm run vault:sync -- push -m "message" <paths>`
pulls with `--rebase --autostash`, adds only the given paths, commits only them and pushes (one
retry after a rejected push). The page calls it in its strict form: it waits, and warns on the
page, while anything outside its own two notes is changed in the vault (Obsidian's `.obsidian/`
UI state does not count) or a git command is running there; it discards its own files before the
pull and writes them again after it, so a pull never has to merge them. A failed push takes back
only its own unpushed commit.

**Session-notes watchdog** (`watchdog.mjs`, D-102 line 6). Recording folders `*-discord` in
`FVTT_SESSIONS_DIR` (default `~/Documents/FoundrySessions`): `recording` (no
`raw/session.json` yet), `empty` (no audio), `done` (`notes/notes.json` has a session
summary), `paused` (the last `notes/audit.jsonl` event is `paused`: the usage limit, amber),
`waiting` (finished under 24 hours ago) and `missed` (24 hours or more, red, also a warning). It
reads only file times, the `event` key of the audit lines and whether `notes.json` has a
session summary. `auto.log` is written only when a pass does something, so its age is shown as
"last logged work", not as a heartbeat.

## Secrets and campaign text

Transcripts hold prompts, tool output and possibly secrets. The scanner keeps only these keys of a
transcript record: `timestamp`, `sessionId`, `customTitle`, `type`, `isSidechain`, `cwd`,
`gitBranch`, `message.id`, `message.model` and the numeric fields of `message.usage`; of a subagent
`.meta.json` only `model`; of `~/.claude/sessions/<pid>.json` only `pid`, `sessionId`, `cwd`,
`name`, `status`, `updatedAt`, `hostSessionId` and `startedAt` (never the `.key` files). Lines
without `"type":"assistant"` or `"customTitle"` are not parsed at all; only their timestamp is
read. The whitelist test (`test/whitelist.test.mjs`) asserts that a snapshot holds no key outside
the snapshot schema and no string over 200 characters.

## Snapshot schema (version 2)

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
  versions: { pc: { asOf, error }, pi: { asOf, error }, newest: { asOf, errors },
              foundry: { newestStable, newestAny, newestAnyChannel },
              rows: [{ id, kind: "core"|"system"|"module", title, pc, pi, newest, minCore,
                       status: "ok"|"behind"|"differs"|"unknown" }] },
  watchdog: { dir, state: "no-folder"|"no-recordings"|"ok"|"waiting"|"paused"|"missed",
              lastPass: ISO|null, items: [{ name, state, finishedAt }] },
  usageLog: { file, since, rows: [{ at, title, event, context, peak }],   // newest 8
              push: { state: "pushed"|"nothing"|"waiting"|"error"|"off"|"never", detail, at },
              waitingSince, nextPushAt },
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

States: **busy** when the session process is live and says busy and the session (main thread or a subagent) was active in the
last 30 minutes (a crashed session's file can say busy forever once Windows reuses its pid);
**waiting** when it is live and idle under an hour; **stale** when idle an hour or more, or when the process is gone. The lane cap counts
sessions not titled "CLOSED ..." with activity in the last hour, minus the steward (the session
titled "... fixes and stewardship").

## Files

| File               | Does                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `cli.mjs`          | entry point: serve, `--lanes`, `--snapshot`                             |
| `paths.mjs`        | data folder, Claude folders, project slug, test environment root        |
| `transcripts.mjs`  | incremental transcript scan (byte offsets, restart when a file shrinks) |
| `sessions.mjs`     | live sessions from `~/.claude/sessions`                                 |
| `lanes.mjs`        | lane rows, states, alarm levels, cache countdown, lane cap              |
| `gh.mjs`           | PRs and CI through `gh` (every 60 s, only while the page is open)       |
| `plan.mjs`         | plan gauges from `plan.json` and `get-usage-plan.json`                  |
| `lock.mjs`         | reads the test server lock                                              |
| `snapshot.mjs`     | builds and writes `snapshot.json`; `assertWhitelisted`                  |
| `versions.mjs`     | versions on the PC test server, the Pi (read-only) and online           |
| `usage-log.mjs`    | measured Usage rows, weekly summary, the two vault notes                |
| `vault.mjs`        | the vault pull and push wrapper (`npm run vault:sync`)                  |
| `watchdog.mjs`     | the session-notes watchdog                                              |
| `housekeeping.mjs` | the server's 5-minute background tick                                   |
| `server.mjs`       | the page server: `127.0.0.1:3200`, rejects any other `Host` header      |
| `page/`            | the page (HTML, CSS, JS; no build step)                                 |
| `plan-meter/`      | the Claude Code plugin that writes `plan.json`                          |
