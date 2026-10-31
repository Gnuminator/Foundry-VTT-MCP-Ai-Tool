### Dashboard

- **Live screen A, review fixes (#654):** Undo and Next turn on the live strip, the header Undo and
  the NPC initiative roll after Start combat now share the dashboard's guarded call, so a refusal
  because GM Actions are off shows the usual toast and a failure says so. The roll after Start
  combat only touches the NPCs of the fight just started (and says so when it cannot find them,
  instead of rolling in an older fight); a player-owned NPC-type creature put in the fight (a
  familiar, say) is now rolled for too. The page has one Undo (the header's), and the toast's
  pointer to the Turn on button now moves focus there.
