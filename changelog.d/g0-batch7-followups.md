### Fixes

- **Item rarity reads as a label in compendium search summaries:** an item's summary says
  "Very Rare" instead of dnd5e's key `veryRare` (all six dnd5e rarities). It also reads the
  `rarities` list that dnd5e 6 source data holds, so world items keep their rarity too.
- **The player page CSP stays on the player page on a well-used NTFS disk:** the dashboard
  recognizes a static file by its id as well as its name, and NTFS ids above 2^53 lost their low
  bits as numbers, so `player.js` could share `player.html`'s id and get its CSP. An id outside the
  exact range is now confirmed with a bigint stat (`static-headers.test.ts` failed 2 tests on one
  PC; CI passed).
