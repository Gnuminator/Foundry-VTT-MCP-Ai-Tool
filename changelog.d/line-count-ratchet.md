### Tests

- **Line-count ratchet:** `npm run line:ratchet` fails when a source file over 1,000 lines grows or a new file crosses
  the limit. The baseline is `scripts/line-baseline.json`; `--update` only lowers it and `--except <file> "<reason>"`
  records a named exception. CI and `green` run it.
