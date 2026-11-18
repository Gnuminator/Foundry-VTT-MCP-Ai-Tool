### Fixes

- **Undoing an AI damage that dropped a hero to 0 HP also stands them up:** the Prone rider dnd5e
  adds together with Unconscious is created in a batch the change journal did not tie to the AI
  change, so the undo left the hero prone. The journal now puts such a rider effect in the AI
  change's group while it is still collecting dnd5e's follow-ups.
