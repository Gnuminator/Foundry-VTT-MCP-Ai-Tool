### Process

- **Merge runner starts the release:** when every PR and item a `release-*` Backlog item depends on has merged, the runner runs `live:roundtrip` on main (own test server lock, the merge train is untouched), posts once in #pr-log and adds a due-today Waiting item that the release is ready to tag (`backlog.mjs waiting`). `--release-session` (off by default) also starts a headless Sonnet release session that stops before the tag and the Pi. It never tags, releases or changes the Pi.
- **Ready-line hint:** "Ready but no ready line" no longer names a `progress` command for a PR whose Backlog item does not exist; it says no item exists and gives an `add` command, then the `progress` command.
