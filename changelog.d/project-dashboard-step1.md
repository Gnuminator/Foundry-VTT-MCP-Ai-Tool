### Developer tools (D-103)

- **Project dashboard, step 1:** `npm run project-dashboard` serves a local developer page on
  `127.0.0.1:3200` (it rejects any other `Host` header) with the lanes table (busy, waiting or stale;
  context amber from 200k and red from 250k; a "do not reuse" badge; minutes until each waiting
  session's cache goes cold; the lane cap count), plan gauges, the test server lock, pull requests
  with their checks and CI on main, and this week's tokens per day. `npm run project-dashboard --
--lanes` prints the lanes table. One scanner reads only whitelisted keys of the Claude Code
  transcripts, incrementally, and writes `snapshot.json` to `~/.foundry-ai-tool/project-dashboard`.
- **Plan meter plugin:** a small Claude Code plugin (`scripts/dev/project-dashboard/plan-meter`)
  writes the 5-hour and weekly plan figures after each turn, since the desktop app's Code tab runs
  no status line.
- **Test server lock (D-101, D-102):** `pwsh scripts/test-env/lock.ps1 take | release | queue |
leave | status` keeps `lock.json` in the test environment's root; `status.ps1` shows the holder.
  `take -Force` takes over from a crashed holder or skips a dead queue head (entries older than 4
  hours are flagged), and a damaged `lock.json` is refused instead of read as free.
