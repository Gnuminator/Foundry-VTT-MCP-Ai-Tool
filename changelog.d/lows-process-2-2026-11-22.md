### Fixes

- **Process lows sweep:** the planner-wake watcher is gone (no standing planner, D-141); `readUpstreamBacklog` now lives in `scripts/backlog-items.mjs`. `backlog.mjs add` and `set` refuse a `--board` value that is not an area in Board.md. The Cloudflare drift check compares undescribed Transform Rules in order instead of reporting them as listed twice, and its coverage test also checks the returned sections and the tunnel names. A timed-out Previously On render frees the GPU lock even when `taskkill` cannot start.
