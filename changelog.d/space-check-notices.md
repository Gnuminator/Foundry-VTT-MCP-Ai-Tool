### Storage space notices

- **Discord DM from the recorder bot:** every 15 minutes the bot reads the Pi's space check file
  (`/var/lib/foundry-ai-tool/space/status.json`, or `FOUNDRY_AI_SPACE_STATUS`). It DMs the owner once
  when free space gets low or critical (or the check goes stale), reminds at most once a day while
  it stays bad, and sends one "back to normal" DM. The owner is `DISCORD_OWNER_ID` when set,
  otherwise the Discord application's owner. A missing file says nothing.
- **Dashboard banner:** a GM-only banner (yellow for low, red for critical) from the new
  `GET /api/space` route; players' pages never ask for it. A stale check shows only in Module
  Diagnostics. No banner when there is no status file.
- **Shared reader:** `shared/src/space-status.ts` parses and checks the status file (version 1) and
  never throws; the bot keeps an identical copy, kept equal by a test.
