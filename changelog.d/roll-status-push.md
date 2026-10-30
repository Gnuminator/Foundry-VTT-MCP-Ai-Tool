### Dashboard

- **Roll requests reach players at once, and the GM sees who has rolled:** a roll request sent from
  the dashboard is pushed over the player stream within a second (it used to wait for the 4 second
  poll and then the 8 second page refresh). The player page shows a banner naming the roll for each
  player it is for, also without the personal link (it still asks "Who are you?" first; the Roll
  button needs the link). The GM's roll bar shows the latest ask as "waiting for 2 of 4" with a
  line per player ("Brenna rolled 17"). The toast says "Sent" and a request has no Undo. The Player
  links card says each player pins their own link in Discord.

### Module

- **Roll request events name the player:** the `roll-request` session event now carries
  `details.targetUserId`, so the dashboard can tell who still owes a roll (older modules fall back
  to the whisper list for a private request).
