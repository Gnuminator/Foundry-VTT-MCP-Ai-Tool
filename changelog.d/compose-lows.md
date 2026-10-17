### Fixes

- **`demo:compose` checks the take frame rate up front (#342 round 2 lows):** a take that is not 60 fps, or whose rate cannot be read, now stops the run in `preflight` before the first encode instead of after the earlier chapters are built. New tests cover the chapter id and cut name rules, the repo guard for `--out`, `preflight` and the frame-rate check, and `DEMO-RECORDINGS.md` says that an apostrophe in the output path is a hard stop (pass `--out`).
