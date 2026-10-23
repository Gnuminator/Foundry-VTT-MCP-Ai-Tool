### Dashboard

- **Private rolls in the Live Feed:** a whispered or blind roll reads "private roll" on its chip (it said `gm-roll`), and a roll request shows as its own "roll request" line ("Private roll request to Alice: ...").
- **Your private rolls on /me:** a player's own page lists the private rolls asked of them and their results (only the line they may read: no DC or outcome unless dnd5e shows them). Nothing from other players, blind rolls, the GM's own rolls or public requests.

### Module

- **Roll requests are session events:** `request-player-rolls`, `request-ability-check` and `request-attack-roll` log a `roll-request` event (GM only; the /player feed never shows it). A private roll's event records who it was whispered to.
