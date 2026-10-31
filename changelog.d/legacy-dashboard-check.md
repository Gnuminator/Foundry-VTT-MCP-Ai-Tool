### Tooling

- **A check keeps the old dashboard out:** `npm run kit:test` (so CI and `npm run green`) now fails when a test, kit run, demo script, skill or guide names `/legacy/` or the old page's files, unless the file is on a short list of places that test the old page or its routes on purpose. The list shrinks as the old page's last tests go.
