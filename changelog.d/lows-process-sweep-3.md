### Process and tooling

- **Process lows swept:** the release red-post notice now repeats when the kind of red changes (failed, then could not run) and is marked after it is posted; the merge-runner notice store keeps 1000 keys instead of 200; the plugin install check compares install paths with a separator, quotes the sed path and times out a hook after 30 seconds; the refresh module comment names the tool-reference test and the lease push; new tests cover the refresh refusal for a head already in main and the two-parent refresh merge.
