### Dashboard

- **Start combat with a token picker:** with no fight running and GM Actions on, the Combat Tracker
  offers Start combat. It lists every token on the scene, with the player characters and Hostile
  tokens ticked and Neutral and Friendly ones not (Foundry's token disposition); you change the ticks
  and start. The fight is created at round 1 and logged in Recent Changes with Undo. The tracker
  card still shows with no fight only in the Full view (david-start-combat-picker).

### Module

- **`plan-combat-change` start action:** Claude can start a fight too (`action: "start"`, optional
  `tokenIds`; by default the player characters and Hostile tokens). The combat is created already
  begun, and the session log still gets its "Combat started" line.
