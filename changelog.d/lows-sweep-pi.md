### Fixes

- **Pi stage scripts, small review findings:** stages 6 (nightly backup tells a gone container from a silent Docker, restic summary kept in the journal), 24, 28, 30 (an interrupted run no longer leaves a service on old settings), 31 (folder list read once, device id checks, removal needs a known index) and 32 (a lost clock alert is retried, NTP warning), plus the game night watch (stop flushes its end post) and `require_quiet` (refuses at once on a silent Docker). Tests and container scenarios added (Backlog `lows-sweep-pi`).
