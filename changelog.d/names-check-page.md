### Session notes

- **Names and facts to check:** every notes run writes a page per language in the session's `notes/` folder with the uncertain names (spelling variants merged, count, timestamp links, a suggestion from `names.txt`) and a few facts where a hint disagrees with its owner. The reviewer writes the right spelling, `same as X` or `not a name`; the next run reads the answers into `names.txt` and `rules.json` and rewrites only the scenes they touch. `session-notes check <session>` does the page and the answers without a Claude call (backlog `names-check-page`).
