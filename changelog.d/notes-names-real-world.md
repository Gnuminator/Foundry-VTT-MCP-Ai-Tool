### Session notes

- **Names come from the real world:** `voice-stack.ps1 names` reads the Pi dashboard when the user variable `FVTT_NAMES_DASHBOARD` is set (token from `GM_DASHBOARD_TOKEN`), and refuses a dashboard whose world is not the campaign (`curse-of-strahd`, or `FVTT_CAMPAIGN_WORLD`) unless `-AnyWorld` is given, so a test world's names no longer end up in `names.txt`. A good read is saved to `campaign-names.txt` in the sessions folder and used when the dashboard is down (backlog `notes-names-real-world`).
