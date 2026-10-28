### Pi (stage 17, second live failure)

- **Stage 17 installs libicu when it is missing:** the second live run got past the folder fix and then failed to register because the Pi has no libicu, which GitHub's `config.sh` needs even with invariant globalization. The stage now installs the newest `libicuNN` package apt knows (`libicu72` on Debian 12) only when no libicu is in the library cache, says so, and removes nothing.
- **Stage 17 shows why registering failed:** `config.sh` reports on stdout, which the stage sent to `/dev/null`, so the error blamed an old token. The last lines of its output are now printed on failure, minus any line that could hold the token. The ARM64 container scenario now starts without ICU and fails on the old script.
