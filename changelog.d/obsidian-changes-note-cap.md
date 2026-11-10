### Obsidian

- **A busy month no longer makes one giant change-log note:** the monthly `AI Tool/Changes/<month>.md` note now holds at most 400 changes and rolls over to `<month>-p2.md`, `-p3` and so on (oldest changes stay in the first note, so a full note never changes); one change shows at most 40 diff lines. A 2.9 MB note with 6,864 changes had made Obsidian run out of memory and show a grey screen when it opened the test vault. Session notes link to the right part (Backlog `obsidian-test-vault-fix`).
- **Small test vault for the plugin:** `node scripts/test-env/small-obsidian-vault.mjs` builds a throwaway vault with the plugin and a made-up Library, for checking the graph commands by hand.
