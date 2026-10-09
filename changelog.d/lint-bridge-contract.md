### Development

- **Typed bridge queries (lint zero step 2):** `shared/src/bridge-queries.ts` names the request
  and reply of 18 bridge queries once, for the backend and the module: the guarded write queries,
  the change journal, play and usage records, the journal folder and show-to-players queries, the
  player pages, the export and Library indexes, the character sheet, `getCharacterEntity` and
  `ping`. The module registers those handlers with `bridgeHandlers.on()`, which checks each reply
  against the contract; `FoundryClient.query` returns the typed reply or the module's refusal
  (`{ success: false, error }`). The services share one `unwrapBridgeReply` instead of four local
  copies, and the pumps lose their casts. The queries the `src/tools/` tools send join after the
  G0 lanes merge. Nothing changes on the wire; old modules and bridges still talk to each other.
- **System detection after a refusal:** when the GM gate refused `getWorldInfo` (a client that
  is not the GM's), the bridge cached the world as "not dnd5e" until a restart. It now treats the
  refusal like a failed query and asks again on the next call.
