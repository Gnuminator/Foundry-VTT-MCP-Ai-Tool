# Item Piles (`item-piles`, with `itempilesdnd5e`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 3.3.4 plus the companion `itempilesdnd5e` 1.1.0, 2026-10-28 (test server B; piles, loot pick-up as a player, turning a token into a pile and back, and our tools around it were driven live; merchants, trading, vaults and the death-to-loot setting were not).

**Verdict: optional.** It is the working replacement for Loot Sheet NPC 5e, which has no dnd5e 6 build, and a player can take loot from a pile with one click. It is also one more module to learn, and it puts character-type pile actors into the world that our tools list as characters. Turn it on only if Danni wants loot drops or shops.

**For Danni's guides:** Drop a bag on the map, put items in it, and players click an item to take it; for a monster's loot, turn its token into a pile.

## What it does

- A pile is a token (or a world actor) with the Item Piles flag. A player who clicks it, or who is sent there by the GM, sees its items and a **Take** button per item; the GM sees the same window with edit controls.
- Piles can be loot, containers (open, closed, locked), merchants with prices, or vaults. Players can also trade with each other (**Request Trade** button) and give items.
- A pick-up posts a public chat card, "<name> picked up the following items: ...".
- Since 3.x the core module is **system-agnostic**. dnd5e support (currencies, item price, quantity, loot types) comes from the companion module `itempilesdnd5e`; without it the module opens a "System Not Recognized" dialog on every GM load and works only in a limited way (seen live).

## Where its UI is

- Token HUD: an Item Piles button on a token's HUD turns it into a pile or back.
- Scene controls: bottom-left **Request Trade** button for everyone; pile controls for the GM in the token layer.
- The pile window itself ("Item Pile"): **Open Sheet**, **Show To Players**, **Configure Pile**, **Config Update**, **Split currency**, **Leave**.
- Configure Settings > Item Piles: 40 settings; most are hidden behind its own menus (currencies, item filters, pile defaults).

## Settings we use and why

Keys are `item-piles.<key>`.

| Label (client)        | Key                | Default                  | Our value / reason                                                                          |
| --------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| (hidden) system found | `systemFound`      | false with the companion | read it only; the companion's config is applied anyway (currencies show PP, GP, EP, SP, CP) |
| Delete empty piles    | `deleteEmptyPiles` | on                       | leave: an emptied bag disappears                                                            |
| Enable trading        | `enableTrading`    | on                       | leave; turn off if the table never trades                                                   |
| Output to chat        | `outputToChat`     | on                       | leave: the pick-up card is the loot record the AI can read                                  |
| Pile defaults         | `pileDefaults`     | see UI                   | leave; one pile uses "display one item" which renames the token (see Gotchas)               |

## How it interacts with the AI Tool

- **Characters list.** A pile is an actor of type `character` ("Default Item Pile" plus one per pile). `list-characters` returns it next to the real PCs, and `get-token-positions` returns the pile token with category `npc` and HP 0 of 0 (seen live). Name piles clearly; do not read them as party members.
- **Loot.** No tool gives or takes pile items. `search-character-items` and `get-character` can read a pile actor's items by its actor id (not run live). The pick-up chat card shows up in `get-chat-log` as a plain message (`messageType: other`, flag `item-piles`) with the items in the HTML; the play recorder logs nothing for it.
- Our writes survive: moving or hiding a pile token through `plan-token-change` was not run; HP and conditions do not apply to piles.
- No `foundry-mcp-bridge` setting is needed. `manage-world-items` (Build set) creates world items, which can be dropped into a pile by hand.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility.verified` is 14 (minimum 13, maximum 14). It requires `lib-wrapper` and `socketlib`; the companion requires Item Piles 3.2.7 or newer.
- **No dnd5e profile in the core module.** Install both modules, or every GM load shows "System Not Recognized".
- **Welcome cards.** The first GM load posts a "System Support Update" chat card that is **public** (whisper list empty, seen live), so players see it. Delete it before session 0.
- **Revert after "display one item".** Turning an NPC token with exactly one lootable item into a pile renamed the token to that item and swapped its image; turning it back left the saved name changed (the Aboleth became "Tentacle") until I renamed it, while the saved image was right. A reload fixed the picture. Check the token name after reverting.
- V1 application deprecation warning at load ("The V1 Application framework is deprecated").
- Removing the module leaves the pile actors, tokens and `flags.item-piles` data behind.
- Pi: nothing platform-specific found. Leftovers on test server B's `ai-tool-test`: actor "Default Item Pile" and one pile token on the scene "Place Spread Test" (kept).

## Sources

- Repo and README: https://github.com/fantasycalendar/FoundryVTT-ItemPiles and https://github.com/fantasycalendar/FoundryVTT-ItemPilesDnD5e
- Manifests: `C:\FoundryTestB\data\Data\modules\item-piles\module.json`, `...\itempilesdnd5e\module.json`.
- Source read: `dist\item-piles.js` (system-support notice, plugin list), `languages\en.json`.
