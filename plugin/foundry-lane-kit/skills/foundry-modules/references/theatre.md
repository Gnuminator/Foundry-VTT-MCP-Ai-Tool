# Theatre Inserts (`theatre`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 3.4.2, 2026-10-28 (test server B; adding an actor to the bar, staging an insert and sending a line as the GM were driven live; emotes, the narrator bar, the player side and text animation were not).

**Verdict: drop.** It gives a visual-novel stage for talking NPCs, but the lines it posts carry no speaker, our log reads them as out-of-character chat from the user, it hides the hotbar, and the package is 247 MB. For a GM new to Foundry it is the wrong thing to learn first.

**For Danni's guides:** Not needed. It shows a character's portrait on screen while they speak.

## What it does

A "theatre" of portrait inserts: add an actor to the Theatre bar, click its portrait, and the character is staged at the bottom of every screen while text types out; emotes and animations are available. Chat lines are posted as ordinary chat messages with a Theatre flag.

## Where its UI is

- The chat form gets a row of portraits (the Theatre bar) and the toggles "Delay Emote Until Message", "Automatic Alias Quotes" and "Resync Theatre to GM" (seen on a player's screen).
- Stage: a canvas dock at the bottom of the screen and a text box at the bottom left. With "Hide Bottom UI Elements Automatically" on, the hotbar disappears while the stage is up.
- Configure Settings > Theatre Inserts: 19 visible settings, below.

## Settings we use and why

Keys are `theatre.<key>`.

| Label (client)                        | Key                    | Scope | Value         | Why                                                      |
| ------------------------------------- | ---------------------- | ----- | ------------- | -------------------------------------------------------- |
| GM controls only                      | `gmOnly`               | world | off (default) | **on** if kept: players cannot stage inserts             |
| Hide Bottom UI Elements Automatically | `autoHideBottom`       | world | on (default)  | off if players need the hotbar during a scene            |
| Ignore Theatre Messages From Chat     | `ignoreMessagesToChat` | world | off (default) | leave; on keeps the lines off the chat log (and our log) |
| Theatre Bar Display Mode              | `theatreStyle`         | world | textbox       | leave                                                    |

## How it interacts with the AI Tool

- **Speaker is lost.** I clicked the Test Hero portrait in the Theatre bar, typed a line in the chat box and pressed Enter (Theatre's own path, not a script), and the line was created as `type: base` with `speaker = { scene: null, actor: null, token: null }` and flag `theatre.theatreMessage`. `get-chat-log` returned it as `messageType: ooc`, `speakerName: "Claude"` (the user), `actorId: null`, content `<p>Well met, traveller.</p>`. A scene played through Theatre therefore reads in recaps and the session log as one player's out-of-character chat, not as the NPC speaking.
- `send-chat-message` and `get-chat-log` otherwise work unchanged. No tool stages inserts.
- Adding Test Hero to the bar changed neither the user's flags nor the actor's flags (both read back empty), so the bar list lives elsewhere (a setting; not traced). No document of ours is touched.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 13, verified and maximum 14. It requires `lib-wrapper` and `socketlib`.
- Load log: "theatre | RESYNC REQUEST TIMEOUT" and "OUR DOCK IS NOT ACTIVE, Not responding to reqresync" warnings, repeated, when no stage is up. Harmless.
- The v14 chat box is the new rich-text editor: the Theatre line posted as a paragraph; I did not check the emote shortcuts there (not verified).
- The folder is 247 MB on disk (fonts, textures, sounds).
- Removing it leaves every Theatre chat message with its flag, and its stored bar settings.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/League-of-Foundry-Developers/fvtt-module-theatre
- `C:\FoundryTestB\data\Data\modules\theatre\module.json`; settings and chat messages read live.
