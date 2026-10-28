# Sequencer (`sequencer`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 4.3.0, 2026-10-28 (loaded on test server A; settings, scene controls, the journal and the chat card read from the live world; the Effects Manager window was not opened, marked "(not verified)").

**Verdict: keep.** It is a dependency of Automated Animations, so drop it only together with that module. Version 4.3.0 is verified on Foundry 14 and does nothing until another module asks it for an effect. It leaves two traces in the world: a `sequencerDatabase` journal and a one-time GM whisper after an update.

**For Danni's guides:** You will not touch this one; it is the engine that plays spell effects and has to stay on while animations are on.

## What it does

An effect engine for the canvas. Other modules and macros chain effects, sounds and animations in a `Sequence` (video, sprites, text, shapes; `.motion()` is new in 4.3.0). It keeps a database of named file paths that modules register (JB2A registers its clips here), stores persistent effects in document flags, and relays effects to other clients over `module.sequencer`. It needs nothing; it uses libWrapper if present and has its own small fallback otherwise.

## Where its UI is

- Scene controls get the Sequencer tools (Effects Manager, Database Viewer, effect tools on tokens), unless `showSidebarTools` is off.
- Configure Settings > Sequencer: the settings below. No menu.

## Settings we use and why

Keys are `sequencer.<key>`.

| Label (client)            | Key                         | Scope  | Default   | Our value / reason                                      |
| ------------------------- | --------------------------- | ------ | --------- | ------------------------------------------------------- |
| Effects enabled           | `effectsEnabled`            | client | on        | a player on a weak PC may switch it off (reload needed) |
| Sounds enabled            | `soundsEnabled`             | client | on        | leave                                                   |
| Create effects permission | `permissions-effect-create` | world  | Player    | leave: five trusted friends (D-065)                     |
| Delete effects permission | `permissions-effect-delete` | world  | Assistant | leave                                                   |
| Preload permission        | `permissions-preload`       | world  | Trusted   | leave                                                   |
| Sidebar tools             | `showSidebarTools`          | client | on        | off for players who find the extra buttons confusing    |

## How it interacts with the AI Tool

- **Journals.** On the first load as GM it creates a journal entry named `sequencerDatabase` with default ownership Owner. `list-journals` and `search-journals` will list it (seen live, with no pages); it is not campaign content.
- **Chat.** After an install or minor update the GMs get one whispered "Sequencer updated to v4.3.0" card (class `sequencer-welcome`; seen live, whispered to all three GM accounts of the test world). `get-chat-log` and the play recorder see it once.
- **Scene controls.** Seen live: a "Sequencer" control group (select effect, play effect, effect viewer, database) and the same viewer and database tools in the Token controls.
- **Effects.** No tool plays effects. Persistent effects live in `flags.sequencer` on tokens, tiles and templates.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Compatible with 13 to 14; the code branches on v14. 4.3.0 fixed finished sequences filling the Effects Manager and a video memory leak in `.copySprite()`.
- It does not touch actors or items, so dnd5e 6 does not matter.
- Core photosensitive mode disables most visual output.
- Effects replicate to players over its socket, so a connected GM client is not required, but the permission settings above gate who may send.
- Setting changes that need a reload do nothing until each client reloads.
- Removing it leaves the `sequencerDatabase` journal and any persistent-effect flags.
- JB2A does not declare it in its manifest but fails to register its clips without it.

## Sources

- Repo: https://github.com/fantasycalendar/FoundryVTT-Sequencer
- `C:\FoundryTest\data\Data\modules\sequencer\module.json`, `languages\en-EN.json`, `dist\sequencer.js` (searched, 1.29 MB), `typings\`.
