### Scene restore (I-128; ships off)

- **`plan-scene-restore` (play set):** puts a scene's walls, lights, tiles and tokens back from a
  copy of the world, for a map the GM broke by hand (Undo covers AI changes only). It compares the
  live scene with the backup copy and plans the difference as one guarded change: what is added
  back, removed, moved or changed, with the usual confirmation (deleting needs the second one),
  Undo and an entry in Recent Changes. Tokens keep their current hit points and effects. Off by
  default: the module setting "AI Tool: Scene restore (writes)" must be on. Reads the backup
  with Foundry's own `classic-level`, so nothing new is installed. Design and use in
  `docs/dev/PLAN-B.md`.
- **Module:** new read-only bridge query `getSceneState` and the feature switch `scene-restore`.
