### Development

- **Green flakes fixed at the cause:** `npm run green` on Windows now runs every step on the
  portable Node 22 when it was started under another Node. Node 24.15 on Windows crashed natively
  (exit code 0xC0000409, no message) in 20 to 40 percent of the co-GM dashboard socket test runs,
  which showed as vitest "Channel closed" and as a dead run; the same tests passed 60 of 60 runs
  on Node 22.22.2, with either vitest pool. The 50,000-character timing check of the
  remote-command guard takes the best of three runs instead of one wall-clock sample (the ARM64
  container suite delayed one run to 207 ms against a 200 ms bound), and the co-GM stream tests
  wait for the last event of the connect snapshot instead of a fixed 30 to 60 ms.
