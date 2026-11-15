### Fixes

- **One Opus pass, narrower list:** the merge gate, CI, green and the hooks (except the `guard-*` security hooks) now take a Sonnet review plus CI. `shared/src` counts as a wire contract only for the seven named contract files, and a test fails on a new `shared/src` file nobody classified. `npm run lane:risky` prints the Opus list.
