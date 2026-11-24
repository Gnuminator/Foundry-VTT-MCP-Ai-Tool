### Module

- **Character, effect, event and item queries of the Play set are typed:** token details, the
  condition list, item use, character resources, active effects, recent events and spent actions
  now have a request and reply type in the shared bridge contract, the module registers them
  through the typed `on`, and the server's saving throw, NPC activity and rest tools send their
  queries through the typed client. No wire name or field changes.
