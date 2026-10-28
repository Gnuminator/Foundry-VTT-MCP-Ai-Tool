# FX Bus (`fxbus`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 0.8.0, 2026-10-28 (test server B; the GM panel and a screen shake received by a second browser were driven live; the Token, Tile and Canvas effect tabs, tethers and the audience picker for single users were not).

**Verdict: drop.** It is a clever screen-shake, pulse and blur panel, and it keeps no data, but a GM new to Foundry will not run effects from a panel while running a table. Revisit it only for a planned cinematic moment, and then by a macro.

**For Danni's guides:** Not needed. It is a panel for screen shake and flashes you can fire for a dramatic moment.

## What it does

GM-broadcast, client-side, non-persistent visual effects: screen shake, pulse, vignette, chromatic aberration, noise, blur, smear, streak, monochrome, plus token motion, tile motion and canvas effects. Version 0.8.0 adds per-player audiences. It changes no scene, token, actor or world data; each client draws the effect itself.

## Where its UI is

- Scene controls: a lightning-bolt **FX Bus** group (and a "reset all" group). Clicking it opens "FX Bus - GM Panel [v0.8.0]" with tabs Token, Tile, Screen, Canvas, Reset.
- Each effect has **Apply to Everyone** (an arrow picks recipients), **Stop**, **Stop All**, **Copy Macro**.

## Settings we use and why

Keys are `fxbus.<key>`, all client scope.

| Label (client)                          | Key                         | Default | Our value / reason                          |
| --------------------------------------- | --------------------------- | ------- | ------------------------------------------- |
| Disable FX Bus effects on this client   | `disableLocalFx`            | off     | a player who gets motion sick turns this on |
| Block FX when reduced motion is enabled | `respectReducedMotion`      | off     | leave                                       |
| Targeted FX reminder interval           | `targetedFxReminderSeconds` | 30      | leave                                       |

## How it interacts with the AI Tool

- **No interaction.** Effects ride a module socket, not documents. After "Apply to Everyone" with "Run until stopped" ticked, the Player's browser held `screenShake` in `fxbus.screenFx` and one ticker; after **Stop All** both were empty (seen live). No scene, token or world flags were written.
- A targeted effect posts one private chat card for the GM that refreshes while it runs (per its README; not seen, only the global effect was run).
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 13, verified 14. It has no dependencies.
- Respects core photosensitive mode and the OS "reduced motion" request: it shows a local warning instead of the effect, which is right for Danni's players.
- An effect left running ("Run until stopped") shakes every connected screen until **Stop All**; remember that at the table.
- Removing it leaves nothing behind.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/SamF111/fxbus
- `C:\FoundryTestB\data\Data\modules\fxbus\README.md`, `module.json`, `scripts\`.
