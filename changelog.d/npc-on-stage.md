### Dashboard

- **NPC on stage:** a card on the live screen puts the NPC the GM speaks as on the table TV. Search an NPC or tap one from the fight; "The players know the name" shows the name, otherwise the TV shows a "?" under the portrait. Off stage clears it.

### Module

- **NPC on stage on the TV:** the Table user's screen shows the portrait and name of the NPC on stage (world setting `npcOnStage`, which holds only what the players may see). New bridge handler `setNpcOnStage` (recordless write, behind Allow Write Operations).

### Tools

- **`set-npc-on-stage` (Play set):** puts an NPC on the TV or takes it off, and logs the time and the NPC in the session log (`npc-on-stage`) so session notes can tell whose voice the GM's lines are. Player characters are refused.
