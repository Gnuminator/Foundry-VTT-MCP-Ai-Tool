### Plan B

- **A full rehearsal on this PC (2026-10-12):** restore from the newest Pi backup, start, check, stop and the push-back build ran on the rehearsal ports (30100, 31614, 31615, 3300) in under a minute. The timings and what was not rehearsed are in `docs/dev/PLAN-B.md` ("Rehearsal record").
- **`check.ps1` waits for the Assistant GM:** right after `start.ps1` it used to report the module link as a problem for up to a minute; it now waits up to 90 seconds (`-WaitSeconds`) while the Assistant GM runs.
- **`stop.ps1` no longer warns about a port that is only closing:** it looks for five seconds before saying a port is still in use.
