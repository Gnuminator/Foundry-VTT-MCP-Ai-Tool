# Share Media (`share-media`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 3.14.3, 2026-10-28 (loaded on test server A; a chat share sent through its API; the sidebar tab, scene controls and settings keys were read from the live client; menus were not clicked through, so those claims are marked "(not verified)").

**Verdict: keep.** Version 3.14.3 is Foundry 14 only, calls out to no outside server and does one job a GM needs at the table: put a picture, handout or video in front of the players now. It adds sidebar and sheet buttons that the GM must learn to ignore.

**For Danni's guides:** To show the players a picture, open the media tab in the sidebar, pick the image and choose pop-up, full screen or chat.

## What it does

A GM tool to push images and videos to players in four ways: a pop-out window, a full-screen overlay, a whispered chat message, or a sprite on the current scene (fit or fill). It adds a media sidebar tab with a history, a media browser, share buttons on actor and item sheets, actor and tile HUDs and images in journals, a Tile option, and a Region behavior (`ShareRegion`) that shows media when a token enters an area.

## Where its UI is

- A sidebar tab (`shm-media-sidebar`) before Settings; hidden for users on the blacklist.
- Share buttons in the header of actor and item sheets (GM only), the actor and tile HUDs, and on journal images.
- A "share" option on chat messages (context menu).
- A scene control group "Share Media" (the `shm-media-layer`) with select, link, browser and clear tools (seen live; my first draft said there was none).
- Tile configuration: a Share Media section. Region configuration: the `ShareRegion` behavior.
- Configure Settings > Share Media: four GM-only menus (media settings, sidebar, entity sharing, blacklist). No hotkey.

## Settings we use and why

All are `config: false` and edited in the four menus. Keys are `share-media.<key>`.

| Label (menu)   | Key                     | Scope | Default                                                             | Our value / reason                                                          |
| -------------- | ----------------------- | ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Media settings | `mediaSettings`         | world | popout darkness on, fullscreen controls on, video loop and mute off | leave                                                                       |
| Sidebar        | `mediaSidebarSettings`  | world | enabled, GM only off, all four layers on                            | turn "GM only" on so players do not see the history tab (not verified live) |
| Entity sharing | `entitySharingSettings` | world | share buttons on for actors, items, tiles                           | leave                                                                       |
| Blacklist      | `blacklistSettings`     | world | empty                                                               | leave; a change forces a reload                                             |
| (hidden)       | `mediaHistory`          | world | `{}`                                                                | grows with every share; clear it from the sidebar if it gets long           |

## How it interacts with the AI Tool

- **Chat.** A chat share is a normal `ChatMessage` with an image or video and `flags.share-media.media` (source and settings). Seen live: a share to "all users" is public (no whisper), a share to chosen users is whispered to them. `get-chat-log` and the play recorder see it like any message.
- **Scenes and regions.** No scenes are created. Tiles and regions that use it carry `flags.share-media.media`; a region with the behavior has a `ShareRegion` behavior document, so tools that list region behaviors will see an unfamiliar type (not verified live).
- **No tool drives it.** The module has an API (`game.modules.get("share-media").api`: `share`, `popoutToAllUsers`, `fullscreenToAllUsers`, `chatToAllUsers`, `sceneFit`, `sceneFill`, GM only), but nothing in the AI Tool calls it. A future "show this handout" tool would need the plan and confirm step, because the module does no spoiler filtering. (not verified live)
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Foundry 14 only (`minimum`, `verified` and `maximum` are all 14). It uses the v14 user query system instead of raw sockets, even though the manifest declares `socket: true`.
- No network calls and no credentials were found in the code. The media browser can create folders and upload files in the Data folder, only on a GM click.
- Removing it while `ShareRegion` behaviors exist leaves orphan behaviors (not verified).
- It hooks Enhanced Journal, Campaign Codex and the dnd5e item sheet when those exist; none of that is needed.
- A Region behavior only works for worlds that have the module, so do not use it in a scene that is exported or shared.
- Nothing about the Pi changes it; media files sit in the Data folder of the host.

## Sources

- Repo: https://github.com/mech-tools/share-media
- `C:\FoundryTest\data\Data\modules\share-media\module.json`, `languages\en.json`, `templates\`, `share-media.mjs` (read, about 4,300 lines).
