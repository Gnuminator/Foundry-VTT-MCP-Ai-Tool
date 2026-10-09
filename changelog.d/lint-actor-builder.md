### Development

- **Typed actor builder (lint zero step 3, actor-builder sweep):** `data-access/actor-builder.ts`
  (NPC creation, attack, aura, save, passive and attack-with-save features, spellcasting,
  compendium spell and feature imports, item and NPC activity use) takes and returns named,
  exported input and result types instead of `any`, and the data-access facade uses them. ESLint
  warnings drop from 4114 to 3612; the file has one left (a deliberate `||`). The dnd5e item
  literals are unchanged and nothing changes on the wire; the one runtime difference is that a
  failed `useItem` keeps the original error as `cause`.
