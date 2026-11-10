### Fixes

- **Test and CI review lows:** the vault-canary test waits for three equal reads before it checks the folders, the stream-state spec says what its second test covers, the studio pin check has a five minute download cap (and the CI job ten minutes), exits 2 for a missing `--stage` file or a flag without a value, the CI path filter keeps the diff in a variable, PI-SETUP names `npm run studio:pin-check`, and the Actor Studio comparison takes the effect share only when a source exists (Backlog: pr896-lows, pr885-lows).
