### Fixes

- **A failed first connect no longer fails the module's ready step:** when the AI Tool server does not answer in time at Foundry start (the daily restart, the Assistant GM joining while the backend comes up), the module logs a warning and keeps retrying in the background, instead of logging "Failed during ready: Connection timeout" and skipping the creature and player book index warm-ups.
