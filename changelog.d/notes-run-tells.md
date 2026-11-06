### Session notes

- **The notes pipeline tells the GM when it stops:** the automatic pass (`auto.ps1`) now posts one short line to the GM bot channel when the notes run is paused (usage limit, or Claude logged out), a session is skipped for missing recording consent, a transcription, notes run or publish to Foundry fails, or notes are published with raw-text scenes. Each event is posted once (a paused or failed step once per day); the line names the session folder only. New `announce.mjs gm-bot` kind; channel `DISCORD_GM_BOT_CHANNEL_ID`, else `GAMENIGHT_WATCH_CHANNEL_ID`.
