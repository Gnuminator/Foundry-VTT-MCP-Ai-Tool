### Session notes

- **Notes run by themselves after a game night:** `tools/session-notes/register-auto.ps1` registers a Windows scheduled task (hourly and at logon, catches up after the PC was off) that runs `auto.ps1`: transcribe, write the notes, publish to the GM-only journal. A usage-limit pause continues the next hour.
- **Consent gate:** nothing is transcribed, written or published unless every speaker has a recorded yes in `consent.json` (`session-notes consent set | list | check`). A blocked session shows as "waiting" with the reason in the After view.
