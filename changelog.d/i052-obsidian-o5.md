### Obsidian (I-052 O5)

- **Keep a prep note from Claude:** the companion plugin gets "Toggle: Claude may read this prep note", which sets `ai_context` to false or true on the open prep note.
- **Prep notes stay private:** a test now checks that a note with `ai_context: false`, a mirror note, a sync-conflict copy and a prep template never reach what Claude reads.
