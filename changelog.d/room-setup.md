### Room setup tools (I-133; ships off)

- **`plan-room-setup` (build set):** Claude sets up scene parts with Foundry 14 Regions, in grid
  squares counted from the map's top left. `teleport` makes an entry rectangle that moves any token
  entering it to an arrival rectangle, on the same scene or another (optionally both ways, optionally
  asking the player first). `spawn` makes a labelled room rectangle and puts tokens from actors on
  free squares inside it, hidden from players unless asked otherwise (Foundry has no spawn-on-enter
  behavior, so the tokens appear when the plan is applied). The usual plan, confirm and Undo apply;
  Undo removes everything the plan made. Off by default: the module setting "AI Tool: Room setup
  (writes)" must be on. Scene Levels and more region kinds are a follow-up.
- **Module:** new read-only bridge query `planRoomSetup` and the feature switch `room-setup`.
