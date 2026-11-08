### Actor Studio fork (2.10.5-aitool.8)

- **Take Average:** with the forced-average switch on, a hero levelled from 1 to 2 now records the average, not the roll (the fork sends real input and change events to the dnd5e 6 checkbox).
- **Magic Initiate:** a Sage, Acolyte or Guide background offers only the Wizard, Cleric or Druid spell list; a freely chosen Magic Initiate still offers all three.
- **Spell ability:** the casting ability picked on the first spell step of a feat or lineage is carried to the second step.
- **Cantrips:** the Spells tab counts cantrips that effects add, so a Thaumaturge cleric sees 4 cantrip slots at level 1 (level-up flow not checked live).
- **Focus lists:** the holy, arcane and druidic focus lists show only the matching focuses (checked live for the holy focus).
- **Open:** a focus picked on the Equipment tab is lost when switching to another tab and back; cause not found yet. The fork release and the stage 13 pin follow in a later Pi sitting (fork PR Gnuminator/foundryvtt-actor-studio#1).
