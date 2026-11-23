### Fixes

- **Recorder converts a crashed half on a later pass:** the bot now looks for unconverted recordings again every 15 minutes, so a crash followed by a restart within the 10 minute guard is converted on a later pass and the owner gets the recover message (recorder-recover-retry).
