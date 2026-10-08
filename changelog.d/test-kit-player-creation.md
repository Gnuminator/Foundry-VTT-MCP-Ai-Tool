### Test kit

- **A player makes a level-1 character (session 0):** the new scenario `player-character-creation`
  joins the kit world as the kit player in its own browser and builds a level-1 character per class
  in Actor Studio, the way players will at session 0: abilities, species, background, class, the
  advancement questions, the starting equipment and the spells. The GM side then checks the sheet:
  the player owns it, one level of the class, species and background, level-1 hit points, every
  planned item on the sheet, every spell on the class's spell list, no console errors on the player
  page. It grants the Player role "Create New Actors" (Actor Studio needs it) and turns on Actor
  Studio's starting equipment for the run, and puts both back. Smoke builds a fighter and a wizard,
  full every 2024 class.
- **Actor Studio's Equipment tab driven by the kit:** the gold choices, the equipment choices, the
  item pickers ("any gaming set") and Confirm. Profiles may name `packs.equipment` (the srd profile
  uses `dnd5e.equipment24`); Actor Studio reads its item pickers from that list.
- **`t.joinFoundry(user)`:** a scenario can join the kit world as another user in a separate
  headless Edge; the runner closes it after the scenario.
