### Development

- **Local checks with many lanes:** `npm run green` takes the heavy-check lock once per run and
  keeps it to its last heavy step, instead of queueing again for every step (with ten lanes a
  5-minute green took 30 to 40 minutes). Waiters are served in arrival order; the merge gate's
  drift check and the pre-push hook go first. The slot count comes from
  `~/.foundry-ai-tool/heavy-lock.json` (`HEAVY_LOCK_SLOTS` still wins), read on every poll, so a
  change applies with no restart; a second or third run starts only while enough RAM is free.
  `node scripts/heavy-lock.mjs status` shows the settings, the holders and who waits.
- **No second check on push:** green records the tree it passed on, uncommitted edits included, and
  the pre-push hook skips its checks when every pushed commit has that tree.
- **Parallel greens and e2e:** two greens never run the dashboard e2e step at the same time (it
  shares a state folder), and green gives it a free port (`E2E_PORT`), so a run on the default
  port elsewhere cannot fail it.
- **Green timings:** each run writes `timings.json` (step times, lock wait) next to its logs, and
  two greens started in the same second no longer share one log folder.
