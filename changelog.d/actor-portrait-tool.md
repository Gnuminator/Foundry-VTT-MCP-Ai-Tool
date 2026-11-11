### Tools

- **Pictures for actors:** new Build tool `plan-actor-image` plans a new portrait and/or token picture for an actor from a PNG, JPG or WebP file (up to 5 MB) in an allowed folder on the GM's PC (`FOUNDRY_AI_TOOL_IMAGE_ROOTS`, default `Documents\Foundry Art`). The file goes into the world's `assets/ai-art/<actor>` folder, apply confirms, and undo puts the old picture paths back. New switch "AI Tool: Actor images (writes)". Players still use `/me` (Backlog `claude-actor-portrait`).
