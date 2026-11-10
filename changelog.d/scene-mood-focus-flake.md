### Fixes

- **Scene mood focus after a scene change:** after the click that reloads the moods because the scene changed, the focus now moves to the first mood once the new list is on screen, instead of on a frame callback that could run before it (Backlog `scene-mood-focus-flake`).
