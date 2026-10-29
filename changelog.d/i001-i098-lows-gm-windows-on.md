### Module

- **GM windows are on by default:** the world switch "AI Tool: GM windows" now starts ticked, so a new world gets the Combat, Party, Session, Scene and Loot buttons without a trip to the settings (W52). A world where the module settings were ever saved keeps the switch as it was (Foundry stores every setting on save); tick it once there.

### Fixes

- **wait-for-game-event:** the reply carries `gap: true` when the `sinceTimestamp` is older than the oldest event the server still remembers (some events were dropped); dead code removed; tests for the handler, abort on a closed connection, the event-type list and the play-log hook. A wait for any event no longer wakes on the AI's own changes and roll requests.
- **Dashboard rate limit:** the asset limit is 5,000 per 10 seconds, the comment says one bucket per tunnel, and a test shows the assets still answer when the page limit is used up.
