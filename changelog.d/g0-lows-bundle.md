### Fixes

- **Undo wording for the AI:** the server instructions now say which kinds the change journal covers (actors, items, effects, tokens, scenes, combat, journals), that music and folders are not undone, which two switches undo needs, and that records are kept 7 days.
- **Roll asks:** the module waits for each roll card's button to be saved before the next ask, so Ask the party no longer loses buttons. Start combat stops asking after the first timeout or lost channel and says who was not asked.
- **Help panel:** the Danish page falls back to English only when it is missing (404); the build warns when a Danish page's headings differ from the English page.
- **Live window:** the "why is this empty" panel is filled in the next frame so screen readers announce it. The new `fmb-live-hello` message (the module says hello to the GM page, which answers with its address) is covered by the e2e stand-in.
- **Dashboard wording:** "Pick from list list" in comments and test titles reads "picker list"; the demo helper comment names the real button "Plan and confirm".
