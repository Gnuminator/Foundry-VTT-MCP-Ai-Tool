# Polyglot (`polyglot`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 2.10.4, 2026-10-28 (test server B; a message in a language a character knows and one in a language they do not, seen as GM and as the Player, were driven live; the language picker beside the chat box, the settings menu and fonts were not opened).

**Verdict: optional.** It is a good fit for a campaign with languages at the table: players who do not know a language see scrambled letters. The cost is that every line needs a language choice, and the real text stays readable to anything of ours that reads chat. Add it if Danni wants language puzzles.

**For Danni's guides:** Pick a language before you speak; players who do not know it see gibberish, everyone else reads it.

## What it does

Adds languages to chat. A message with a language flag is shown in a matching font and scrambled for any user whose character does not know the language. dnd5e's own language list is the provider (`dnd5eLanguageProvider`, 25 languages seen). Known languages come from the actor's traits; the GM sees translations. It also has journal highlighting and fonts for languages (settings exist; not tried).

## Where its UI is

- A language picker beside the chat input (not opened; the message below was created through the chat API).
- On each message a small globe icon in the message header lists the language (`a.polyglot-message-language`, tooltip "Elvish").
- Configure Settings > Polyglot: one visible dnd5e setting ("Replace Special Languages"); the rest sit behind its own menus.

## Settings we use and why

Keys are `polyglot.<key>`; most are registered hidden.

| Label (client)               | Key                  | Scope | Value          | Why                                                                         |
| ---------------------------- | -------------------- | ----- | -------------- | --------------------------------------------------------------------------- |
| Enable Chat Features         | `enableChatFeatures` | world | on (default)   | leave                                                                       |
| Display Translations         | `display-translated` | world | on (default)   | leave: the GM and speakers see the plain text under the garbled one         |
| Default Language             | `defaultLanguage`    | world | empty (Common) | leave                                                                       |
| Hide Indicators from Players | `hideTranslation`    | world | off (default)  | on if the globe should not tell players that a line was in another language |

## How it interacts with the AI Tool

- **The stored text is plain.** A message with flag `polyglot.language = draconic` kept its content "The old tower holds a secret."; only the rendered chat showed scrambled letters (for the Player's character, who knows Common, Dwarvish, Elvish and Goblin, the Draconic line stayed scrambled; the Elvish line showed the translation under the garble). `get-chat-log` returns the clear text.
- So anything of ours that republishes chat to players (the co-GM dashboard's player view, the Discord bot, a recap draft) shows the secret language in the clear. The GM-only recap is fine; do not paste Polyglot lines into a player-facing summary without checking.
- `send-chat-message` posts without a language flag, so the AI's lines are always Common.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 14, verified 14: it will not load on 13 (the older 2.8.3 build was the last verified for 13).
- dnd5e 6 stores languages on the actor as `system.traits.languages.value` (a set) with `communication` for ranged languages; Polyglot read them correctly for Test Hero.
- It adds `dnd5e.SpecialLanguages` as the only visible world setting; the language list itself lives in the hidden `polyglot.Languages` setting.
- Removing it leaves the `flags.polyglot` data on each message; the text stays readable.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/mclemente/fvtt-module-polyglot
- `C:\FoundryTestB\data\Data\modules\polyglot\module.json`; settings and messages read live.
