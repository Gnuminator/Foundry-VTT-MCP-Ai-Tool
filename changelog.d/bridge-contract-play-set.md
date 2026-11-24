### Module

- **Combat, chat, rolls, scene and music queries are typed:** the 25 bridge queries behind the
  combat tracker, saves, rests, NPC activities, chat, roll requests, scenes, token positions,
  targets, music, party, renown and the live, combat and scene plans now have a request and reply
  type in the shared bridge contract, and the module registers them through the typed `on`. No
  wire name or field changes.
