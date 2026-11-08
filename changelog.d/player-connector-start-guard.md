### Player connector

- **The Claude Desktop extension now starts:** Desktop loads the extension file through its own launcher, so the old start check (`require.main === module`) never ran and the extension showed "Not responding" and "didn't respond within 2 minutes". It now always starts; the tests set `FOUNDRY_PLAYER_NO_MAIN=1` to load it as a library, and a new test loads it through `require` and expects the `initialize` answer. Version 0.1.3 (player-connector-canary).
