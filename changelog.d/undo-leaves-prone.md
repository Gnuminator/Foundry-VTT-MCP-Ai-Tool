### Fixes

- **Undoing an AI damage that dropped a hero to 0 HP also stands them up:** dnd5e adds a Prone
  effect together with Unconscious, and the undo only reversed the hit points, so the hero stayed
  prone. The change journal now files that Prone effect under the AI change, and Undo (the Undo
  button, `undo-change` and a planned undo) removes it with the hit points.
