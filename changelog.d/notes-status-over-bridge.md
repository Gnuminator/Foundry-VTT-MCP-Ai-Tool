### Session notes

- **Notes status and the approved recap travel over the bridge:** the notes run now sends how it
  ended (`done`, `paused`, `failed` and so on) and the approved player recap to the bridge
  (`session-notes report`, last step of `auto.ps1`), and the dashboard's After card and "Previously
  on" read them from the bridge. A dashboard on the Pi, with no sessions folder, now shows
  "paused" or "failed". The folder on the PC is still the fallback for an old bridge.
- **Only dated `*-discord` folders count as sessions:** `livekit-recordings`, `.incoming` and other
  scratch folders no longer stand in for the newest session in the After card, "Previously on" or
  the prep digest.
