### Test kit (D-090 lane 2)

- **Species, backgrounds, feats and multiclass heroes, checked (slice 3c):** four new scenarios.
  `origins-species` applies every species of the content profile to a level 1 hero through the
  system's own advancement and checks size, speed and movement modes, senses, trait grants and
  choices, granted features and their uses against the species' own data. `origins-backgrounds` does
  the same for backgrounds (ability score increases under the 2024 rules, skill and tool
  proficiencies, the origin feat and its grants). `origins-feats` adds every feat, one at a time, to a
  copy of a host hero that meets its prerequisites (origin, general, fighting style and epic boon
  feats); a feat no host can take is listed with the prerequisite that failed. `heroes-multiclass`
  builds twelve multiclass heroes by leveling into a second (and third) class: the 13 in the primary
  ability the kit sets, the reduced proficiencies a further class gives, the combined spell slot table
  with Pact Magic kept apart, hit points, hit dice and the features of every class. Every failure is
  KIT, CONTENT or SYSTEM; known and accepted ones go in `data/origins-expected.json`. `smoke` takes a
  sample, `full` does everything the profile has. Details: `docs/dev/TEST-KIT.md`.
- **Test kit internals:** the GM actions `listOrigins`, `describeOrigin` and `cloneHero`; `createHero`
  can now add items (a feat, a second class at its level) to an existing kit hero, take its own ability
  scores and answer a Size choice; `describeClass` can describe a class as a second class. The fake has
  matching species, backgrounds, feats and multiclass rules, with quirks the tests switch on.
- **Test kit slice 3c, first live run:** the four scenarios pass on the `srd` kit world and have no KIT finding on the licensed one. The run fixed how the kit reads dnd5e 6 species speeds and senses, skips advancements of a higher level than the hero, and allows the proficiencies a chosen feature or the class's subclass adds to a second class. Results and what is left: `docs/dev/TEST-KIT.md`.
