### Fixes

- **Scene tools work with no canvas:** `get-current-scene`, `get-token-positions`, `measure-distance`, scene state, the player-visible scene and token placement now fall back to the active scene when the client has no canvas (the Pi's Assistant GM runs with core `noCanvas`, which left them failing with "Scene not found").
