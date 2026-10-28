# FXMaster (`fxmaster`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 8.4.2, 2026-10-28 (test server B; a weather effect, its scene flag, and our scene mood write alongside it were driven live; the Effects panel itself, filters and the Foundry-wide "above fog" option were not opened).

**Verdict: optional.** Rain, fog and drifting embers on the map suit Barovia and cost nothing in play, but Automated Animations with Sequencer and JB2A already cover spell effects, and this adds one more module to learn. Add it if Danni wants fog and weather on the map.

**For Danni's guides:** An Effects button in the scene controls turns on rain, fog, snow or embers for the current scene.

## What it does

Scene-wide particle weather and screen filters (rain, snow, fog, embers, bats and more), per-scene and saved in the scene, plus animated special effects you can place on the canvas. The author's name on the package is Gambit (v8 is the maintained line).

## Where its UI is

- Scene controls get an **Effects** group (control name `effects`) for the GM, with panels for particle effects, filters and specials.
- Configure Settings > FXMaster: seen live, 9 visible settings, below.
- On the first GM load it posts a "Welcome to Gambit's FXMaster V8.4.2" chat card.

## Settings we use and why

Keys are `fxmaster.<key>`; defaults unless noted.

| Label (client)                   | Key                        | Scope  | Value | Why                                              |
| -------------------------------- | -------------------------- | ------ | ----- | ------------------------------------------------ |
| Enable Effects                   | `enable`                   | client | on    | a player on a weak PC may switch it off          |
| Display Effects Above Fog/Vision | `displayEffectsOverVision` | world  | off   | leave; on draws weather over the fog of war      |
| Disable Effects For Everybody    | `disableAll`               | world  | off   | the emergency off switch if a table PC struggles |
| Enable Tooltips                  | `enableTooltips`           | world  | on    | leave                                            |

## How it interacts with the AI Tool

- **Weather is separate from our scene mood.** FXMaster stores an effect as a scene flag: calling its switch hook for rain wrote `flags.fxmaster.effects = { core_rain: { type: "rain" } }` and nothing in `scene.weather`. `plan-scene-mood` sets the core `scene.weather` and `environment.darknessLevel`. With the opt-in switch "AI Tool: Scene mood and music (writes)" on, I applied weather `rain` and darkness 0.4 through `plan-scene-mood` with an FXMaster rain already running: both held (`scene.weather = "rain"`, the FXMaster flag unchanged), and undo restored the scene. They do not know about each other, so a mood plus an FXMaster effect stack.
- `get-current-scene` and `list-scenes` will not show an FXMaster effect (not run; the flag is unknown to them).
- No `foundry-mcp-bridge` setting is needed beyond the mood switch above.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 13, verified and maximum 14: it loads on this core, not beyond.
- The welcome card is **public** (whisper list empty, seen live); players see it. Delete it before session 0.
- Core photosensitive mode and the client `enable` setting turn effects off for that player.
- The package is large (59 MB on disk); the Pi's disk can take it, but the install on the Pi is a separate step.
- Removing it leaves `flags.fxmaster` on scenes and world settings.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/gambit07/fxmaster
- `C:\FoundryTestB\data\Data\modules\fxmaster\module.json`; settings and scene flags read live.
