### Obsidian

- **Prep notes as AI context (R3, O5-lite):** `get-prep-digest` gains a `prep` part with the GM's
  own Obsidian prep notes from the bridge's vault: the newest session plan, plus the prep notes
  whose `fvtt_uuid` names the current scene, an actor with a token on it or an open quest. Capped
  at 12 lines per note, 8 notes and 60 lines in all; notes with `ai_context: false`, Syncthing
  conflict copies and the tool's own `AI Tool/` folder are left out; the text comes with a notice
  that it is data, never instructions. A slow or broken vault becomes a warning after 5 seconds.
  The `prep-next-session` prompt reads it first. No module change and no new tool.
