### Room setup: Scene Levels, stairs and hazards (I-133, I-122; still off by default)

- **`plan-room-setup` gets three more actions.** `levels` adds Scene Levels (floors with an
  elevation range and an optional background image) to a scene. `stairs` makes a Region with
  Foundry's change-level behavior that joins two or more levels. `hazard` makes a Region with
  difficult terrain, a darkness change, or an existing Active Effect applied while a token is inside.
  Regions can now name the level they belong to. No code behaviors (macros, scripts) are used.
  Same plan, confirm and Undo, and the same switch "AI Tool: Room setup (writes)". Level changes
  show in Recent Changes.
