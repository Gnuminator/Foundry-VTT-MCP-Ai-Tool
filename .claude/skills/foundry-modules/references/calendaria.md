# Calendaria (`calendaria`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 1.4.6, 2026-10-28 (loaded on test server A and driven through the world and the browser console; anything not clicked through is marked "(not verified)").

**Verdict: optional.** Version 1.4.6 is Foundry 14 only and is the most capable calendar for the game: a Barovian calendar ships in the box and Travel Pace can slow a journey with its weather. But it has 208 settings, runs its own clock, and rewrites scene darkness and journals on its own, so it earns a place only if Danni wants a visible clock and weather.

**For Danni's guides:** A calendar and clock for the table: it shows the date, the sun and moons, and the weather, and the day can be moved forward with one click.

## What it does

It replaces Foundry's plain world clock with a full campaign calendar. It sets `CONFIG.time.worldCalendarClass` and the round length, so everything that reads `game.time` sees its calendar. Features: a HUD with a sun and moon dial, a month view (Big Calendar), a small calendar, a time keeper and stopwatch, a timeline (Chronicle), calendar notes with repeat rules ("every full moon"), a weather generator with seasons and zones, darkness and ambience that follow the time of day, a table-wide time-skip cinematic, chat timestamps, rest-based time advance and macro triggers at dawn, dusk, midday, midnight and new day. 21 calendars are bundled, including `barovian` (Ravenloft) and `gregorian` (the default). It needs `3ds-atlas`.

## Where its UI is

- The HUD on the canvas (date, time, season and a sun and moon dial; Alt+C toggles it) and, in the Notes scene controls, a button that opens the small calendar (`showToolbarButton`, default on). Seen live: on a fresh world both the HUD and the small calendar are open at first load, showing 1 January 1970.
- Configure Settings > Calendaria > the settings panel (one window with tabs: Home, Module, HUD, Mini Calendar, Big Calendar, Chronicle, Time Keeper, Stopwatch, Sun Dial, Time, Weather, Canvas, Cinematics, Chat, Notes, Macros, Permissions, Fog of War). Calendar Editor and Importer are GM-only menus.
- A "Calendar Notes" folder in the Journal directory.
- Hotkeys are unbound except Alt+C (set under Configure Controls).

## Settings we use and why

Keys are `calendaria.<key>`. Almost all are hidden and edited in the settings panel. Defaults are from the code.

| Label (panel)           | Key                    | Scope | Default     | Our value / reason                                                                       |
| ----------------------- | ---------------------- | ----- | ----------- | ---------------------------------------------------------------------------------------- |
| Active calendar         | `activeCalendar`       | world | `gregorian` | `barovian` for Strahd (not verified live)                                                |
| Sync clock with pause   | `syncClockPause`       | world | off         | leave off: a real-time clock fires `updateWorldTime` every interval and wakes every hook |
| Run clock during combat | `clockRunDuringCombat` | world | off         | leave off                                                                                |
| Advance time on rest    | `advanceTimeOnRest`    | world | off         | on only if the GM wants rests to move the day                                            |
| Darkness sync           | `darknessSync`         | world | off         | leave off while scene darkness is set by hand or by a tool; the module overwrites it     |
| Auto generate weather   | `autoGenerateWeather`  | world | off         | on if Travel Pace's weather slowdown is wanted                                           |
| Cinematic time-skip     | `cinematicEnabled`     | world | off         | off until the GM has tried it                                                            |
| Show calendar HUD       | `showCalendarHUD`      | user  | on          | each player may turn it off                                                              |

## How it interacts with the AI Tool

- **World time.** `game.time.worldTime` stays the source of truth. Any change to it (a Travel Pace button, a rest, the clock, a bridge write) triggers Calendaria's day, event, note and weather logic, scene darkness updates, chat announcements and, if bastions are on, `advanceAllFacilities`. `get-world-info` shows the time value that results. Seen live: advancing `game.time` by one day fired `calendaria.dayChange`, `calendaria.sunrise` and `calendaria.eventTriggered`; at the default settings it made no chat message and no journal and left scene darkness at 0. Moving the time back by one day worked too.
- **Journals.** `list-journals` and `search-journals` see a "Calendar Notes" folder (flag `calendaria.isCalendarNotesFolder`) with per-calendar subfolders. Each note is a journal whose page has the type `calendaria.calendarnote`, with the text in `text.content`. Seen live: the first load with the default `gregorian` calendar created 19 holiday notes (New Year's Day to Easter) as separate journals in two new folders ("Calendar Notes" and "Gregorian"), so the world's journal list grew by 19; a bundled calendar seeds its own festivals the same way. Expect noise; filter by the folder flag (not verified live). Deleting them is blocked by the module's own hooks unless it is bypassed.
- **Scenes.** With darkness sync on, the primary GM client writes `environment.darknessLevel` and ambience on scenes as time moves, so a darkness set through `plan-scene-change` can be overwritten. Scene flags `flags.calendaria.*` hold the per-scene switches.
- **Chat.** It stamps `flags.calendaria.worldTime` on new messages and posts event announcements and chat-command output (event messages may be GM whispers). `get-chat-log` and the play recorder will see them.
- **Combat.** No combat data is written. It follows `combatStart` and `deleteCombat` to hide widgets or pause the clock; the round length is the calendar's `secondsPerRound`.
- **Rests.** `manage-rest` runs dnd5e rest hooks, which Calendaria uses to advance time (`advanceTimeOnRest`, long and short rest hours, bastion orders). Without a setting change the rest does not move the clock.
- No `foundry-mcp-bridge` setting is needed. No tool sets the date; do that in Calendaria's own UI. (not verified live)

## Gotchas on Foundry 14 / dnd5e 6

- Foundry 14 only (`minimum` and `verified` are both 14): user-scope settings and ApplicationV2.
- Only the primary GM client (`ATLAS.isPrimaryGM`) advances time and writes scenes, so nothing happens with no GM connected. Set the primary GM in 3DS:ATLAS settings if the bridge GM and the human GM differ.
- 1.4.6 fixed corrupted calendar overrides on load, the weekday restart per month and an FXMaster trail bug. Older worlds with legacy overrides get repaired on load.
- It changes the round length, which dnd5e reads for effect durations. Check durations after switching calendars.
- It listens to dnd5e rest hooks and `dnd5e.bastionConfiguration`; no dnd5e 6 problem was seen in the code (not verified live).
- Removing the module leaves the Calendar Notes folder and its pages, the settings and message flags behind. The pages have a type the system no longer knows.
- 211 settings are registered on 1.4.6. The labels in the HUD and calendar showed as real words, so the missing `lang` folder is not a problem in practice.
- 3DS:ATLAS announced Calendaria 1.4.7 in a whispered chat message on the first load (see `3ds-atlas`); the installed 1.4.6 is not the newest.

## Sources

- Repo: https://github.com/Sayshal/calendaria
- `C:\FoundryTest\data\Data\modules\calendaria\module.json`, `release_notes.txt`, `calendars\`, `calendaria.mjs` (searched, 1.28 MB minified), `templates\`.
- Repo: `docs/dev/RUNTIME-TEST-PLAN.md` (third-party deprecations), `packages/foundry-module/src/` (journal and scene handlers).
