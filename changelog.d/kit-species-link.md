### Developer tools (D-102)

- **Test kit waits for the species link and cached spells:** dnd5e links a new species item to
  the actor, and adds the cached spells of its Cast activities, with writes it does not await;
  the next advancement manager writes its copy of the actor back whole. The kit started the
  background within about 100 ms of the species, so on a slow run 8 species in `origins-species`
  lost their walking speed and darkvision, and Air Genasi its Shocking Grasp (reported as
  SYSTEM). `createHero` now waits for both after each step and fails the build (as SYSTEM) if
  they never arrive. A player clicking through the forms is far slower than that. The wait lives
  in its own file with unit tests, and resolves spells with the async `fromUuid` so a spell in a
  pack whose index is not loaded is not skipped.
