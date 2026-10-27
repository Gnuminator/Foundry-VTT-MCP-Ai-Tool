# Travel Pace Calculator (`travel-pace`)

Not verified live: drafted from the module's manifest, README and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** Version 5.3.1 is small (a 16 KB script), has no hidden data and answers the question a Strahd table asks all the time: how long to reach the next place. It only touches world time when the GM clicks a button. Its one cost is the `3ds-atlas` dependency.

**For Danni's guides:** Type in a distance and a pace and it tells you how long the trip takes, then posts it to chat; you click one button to move the clock forward.

## What it does

A calculator dialog for D&D 5e travel pace. Distance to time, or time to distance, at Fast, Normal or Slow pace (dnd5e's `CONFIG.DND5E.travelPace`). Speed comes from a chosen traveller actor (a mount, vehicle, NPC or group; a group uses its slowest member) or a default party speed. Units follow dnd5e's travel unit setting. The result goes to chat with the pace's Stealth and Perception effects. If Calendaria is active and `useWeather` is on, weather slows the trip. It needs `3ds-atlas`.

## Where its UI is

- Token scene controls: a route-icon tool ("Travel Pace") opens the calculator for everyone.
- The calculator accepts an actor dropped on its traveller box.
- Chat card: a GM-only "advance world time" button, shown when the result is more than zero minutes. A GM click calls `game.time.advance`; more than one calendar day asks for confirmation first.
- Configure Settings > Travel Pace: two GM-only menus, mounts and weather.

## Settings we use and why

Keys are `travel-pace.<key>`, all world scope.

| Label (client)      | Key                                         | Default    | Our value / reason                                                                                        |
| ------------------- | ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| Show pace effects   | `showEffects`                               | on         | on: the chat card then carries the rules text for the table                                               |
| Advance mode        | `advanceMode`                               | `calendar` | `travel` is the one to prefer for Barovia: a day of travel is not a full calendar day (not verified live) |
| Use weather         | `useWeather`                                | off        | on only with Calendaria and weather generation                                                            |
| Mounts and vehicles | `enabledMounts` (menu)                      | empty list | add the party's wagon or horses                                                                           |
| (hidden)            | `weatherMultipliers`, `severityMultipliers` | `{}`       | leave; built-in severity steps run from none (1) to extreme (0.3)                                         |

The README still mentions a "Use Metric System" setting; 5.3.1 has none, so units come from dnd5e.

## How it interacts with the AI Tool

- **Chat.** The result is a public chat message with a link to the mount and the text of the pace. `get-chat-log` returns it; `flags.travel-pace.result` carries the numbers.
- **World time.** Only the GM's button moves time, through `game.time.advance`. The change is a world-time update, not a document write, so the change journal and undo do not cover it (not verified live). `get-world-info` shows the new time.
- **Actors.** It reads NPC, vehicle and group actors and compendium vehicle indexes; it writes nothing to actors. The mount list holds actor UUIDs; deleted actors are skipped silently.
- **No tool drives it.** The calculator has an API (`game.modules.get("travel-pace").api`: `calculateTravel`, `submitCalculation`, `openCalculator`) and two hooks (`travelPace.preCalculate`, `travelPace.calculated`), but no AI Tool tool calls them; work out a trip in your own head and ask the GM to click. (not verified live)
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Verified on Foundry 14.367 and dnd5e 6.0.0; it breaks below dnd5e 5.3. It reads dnd5e 6's `system.attributes.travel.speeds` and `movement.speed`.
- Day length comes from the active calendar (`game.time.calendar`), so a calendar with a different day length changes the result.
- No `lang` folder ships and the strings are not in the ATLAS language file; where labels load from is not confirmed, so check that they are not raw keys (not verified).
- Removing it leaves only the six world settings and old chat flags.
- Nothing about the Pi changes it.

## Sources

- Repo: https://github.com/Sayshal/travel-pace
- `C:\FoundryTest\data\Data\modules\travel-pace\module.json`, `README.md`, `release_notes.txt`, `templates\chat-message.hbs`, `travel-pace.mjs` (read in full).
