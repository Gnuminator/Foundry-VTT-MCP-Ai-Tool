### Dashboard

- **The React dashboard gets the Party drawer (D-109):** a 🛡 Party button on `/next/` shows the
  dnd5e party as the old page does (members with HP, AC, passive Perception, hit dice,
  conditions, death saves and tokens; the group picker; travel pace, combat and rest), and runs
  its four one-click changes (pace, into the encounter, place the party, rest requests) through
  plan and apply, with Undo on the toast. With GM Actions off nothing is planned and Pre-flight
  opens. Playwright covers every section, the empty and failed states, each change, Undo and the
  refusals.
