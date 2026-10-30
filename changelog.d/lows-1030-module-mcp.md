### Fixes

- **NPC attacks use the GM's targets:** `use-npc-activity` reads the tokens targeted in Foundry the way `get-targets` does: the bridge user's, else an active GM's, so it works when the bridge runs in another GM's browser.
- **Play stats count public rolls per session:** each session in `get-play-stats` carries `publicRolls`, `publicCrits` and `publicFumbles` (blind, GM, self and unrecorded rolls left out), so the After view can post roll counts to Discord without leaking private ones.
- **Prep digest:** when the encounter scan stops at its 100-note limit, the digest says so in its own warning instead of folding it into "could not be read".
- **Docs:** the prep tool-set size figures in `docs/reference/TOOL-SETS.md` match the measured size.
