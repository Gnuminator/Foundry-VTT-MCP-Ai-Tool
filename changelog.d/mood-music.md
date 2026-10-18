### Scene mood and music (I-034, I-129; ships off)

- **`plan-scene-mood` and `list-scene-moods` (play set):** Claude can set a scene's darkness, global
  light, weather and playlist, save a named mood preset on the scene ("Crypt", "Tavern at night"),
  apply it later, and start, stop or switch a playlist ("play the tavern music"). Every change is
  a guarded plan with the usual confirmation, Undo and an entry in Recent Changes, so music can be
  undone too. Off by default: the module setting "AI Tool: Scene mood and music (writes)" must be
  on. `list-scene-moods` shows the presets, the scene's look and the playlists.
- **Module:** new read-only bridge queries `planSceneMood` and `getSceneMoods` and the feature
  switch `scene-mood`. The Play tool set grows to 32 tools and its size budget to 32,000
  characters.
