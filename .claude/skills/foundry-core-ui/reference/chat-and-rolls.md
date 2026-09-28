# Chat and Rolls

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: the chat log and chat input, message visibility modes (the old "roll modes"), chat
commands, dice formulas and modifiers, inline rolls, the message context menu, export and
clear, speaker selection, dice configuration and manual dice, and dnd5e chat cards at a
summary level.

Tag legend: every entry ends with `[unverified]`. The click-through pass replaces it with
`[verified]` or a correction. Bold text is the exact v14 label (from `en.json`), unless the
entry says it is a formula or command.

## How to reach it

- **Chat Messages** - the sidebar tab button (speech-bubbles icon, `fa-comments`) that opens
  the chat log. Path: right edge of the screen > sidebar tab strip > first button. GM and
  players. Reversible (UI only). The tooltip and accessible name come from the ChatMessage
  plural label, not from "Chat Log". [unverified]
- Left-click the tab: makes chat the active tab and expands the sidebar if it was collapsed.
  [unverified]
- Right-click the tab: opens the chat log as a separate window (the popout, element id
  `chat-popout`, window title **Chat Log**). The chat input moves into the popout while it is
  open. [unverified]
- **Focus Chat** keybinding (default Shift+C): activates the chat tab, expands the sidebar and
  focuses the input. Works only when keyboard focus is not in a text field. [unverified]
- **Expand** / **Collapse** - the caret button at the bottom of the sidebar tab strip. It
  toggles the sidebar. With the sidebar collapsed, the chat input still exists, but it floats
  over the bottom-right of the canvas (see "Chat input"). [unverified]
- Gotcha: the sidebar starts collapsed on a fresh page load in v14 (the source never adds the
  expanded class on first render), so the first thing a test sees is the floating input, not
  the sidebar log. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs` (TABS, `_onClickTab`,
`toggleExpanded`), `C:/FoundryTest/app/client/applications/sidebar/sidebar-tab.mjs`
(`activate`, `renderPopout`), `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`
(`focusChat`), `C:/FoundryTest/app/templates/sidebar/tabs.hbs`,
https://foundryvtt.com/article/chat/

## v14 changes compared with the KB articles

The KB articles on chat and dice are old (the chat page shows a 2020 screenshot). Where they
disagree with the 14.368 source, this page follows the source.

- Roll modes are now "message visibility modes" (release 14.355). There are five, not four:
  **Public as User**, **Private to Gamemasters**, **Blind to Gamemasters**, **Self Only**,
  **Public as Character**. The setting is `core.messageMode`; `core.rollMode` and
  `CONFIG.Dice.rollModes` are deprecated until v16.
- The selector is a row of five icon buttons (`#message-modes`), not the dropdown the chat KB
  page describes.
- The mode applies to plain chat text as well as rolls. In **Private to Gamemasters**,
  **Blind to Gamemasters** or **Self Only**, an ordinary typed message is whispered.
- The chat KB page says `/roll` is always public. In v14, `/r` and `/roll` use the active
  mode (the dice KB page agrees with the source).
- The chat KB page says that controlling a token makes plain text in-character. In v14, plain
  text is out-of-character in every mode except **Public as Character**, even with a token
  controlled. Use that mode or `/ic` to speak as the token.
- The chat input is a ProseMirror rich-text editor (`<prose-mirror id="chat-message">`), not
  a textarea. It has a formatting menu and a **Source HTML** editor.
- The source has commands that neither KB page lists: `/gm`, `/players`, `/reply`, `/macro`
  (`/m`), and `/me` for emotes.
- **Pop Out Message** appears only when a message has the `core.canPopout` flag. dnd5e sets
  that flag on every message it creates.
- **Dice Configuration** gained a **Default Method** selector in v14 (release 14.355).
- `ui.sidebar.activeTab` (a v12 property) does not exist in v14. Use
  `ui.sidebar.tabGroups.primary`, `ui.chat.active` and `ui.sidebar.expanded`.

Sources: https://foundryvtt.com/releases/14.355, https://foundryvtt.com/article/chat/,
https://foundryvtt.com/article/dice/, `C:/FoundryTest/app/client/config.mjs`
(`ChatMessage.modes`, deprecated `Dice.rollModes`), `C:/FoundryTest/app/client/game.mjs`
(`messageMode` and deprecated `rollMode` settings)

## Chat log

- **Chat Log** - the scrolling list of messages in the chat tab (`#chat .chat-scroll >
  ol.chat-log`). GM and players. Each message is an `li.chat-message.message` with a
  `data-message-id`. Extra CSS classes mark it as `whisper`, `blind`, `ic` or `emote`.
  [unverified]
- Message header: the sender name (token or actor alias, or the user name for out-of-character
  messages), a relative timestamp ("time since", refreshed every 15 s), and for text whispers a
  **To**: line listing the recipients. The **To** line is not shown on private rolls. dnd5e
  replaces the header with an avatar plus the name and moves the **To** text under the name.
  [unverified]
- Out-of-character messages get a left border in the author's user colour. [unverified]
- Lazy loading: the log renders the newest 100 messages. Older ones load in batches of 100
  only when you scroll to the top, so they are not in the DOM before that. [unverified]
- **Jump to Bottom** - a down-arrow button just above the input. It appears only when the log
  is scrolled up. GM and players. UI only. [unverified]
- Roll messages (core): click the roll area (`.dice-roll`) to expand or collapse the per-die
  breakdown. Under dnd5e, clicking a roll toggles the same expanded state or opens a
  breakdown popover. [unverified]
- Hidden content: other users can still see a gm, blind or self roll message, but it shows as
  **{user} privately rolled some dice** with the result hidden. Whispered text messages are
  invisible to anyone who is not a recipient, the GM included, unless the GM is a recipient.
  [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/chat-message.hbs`,
`C:/FoundryTest/app/templates/sidebar/tabs/chat/log.hbs`,
`C:/FoundryTest/app/client/documents/chat-message.mjs` (`visible`, `isContentVisible`,
`renderHTML`), `C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs`,
https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html

## Chat input

- **Chat** - the accessible name of the message input (`prose-mirror#chat-message`, class
  `chat-input`). Its placeholder, **Enter message**, is drawn by CSS, so an accessibility-tree
  search will not find it; search for the name **Chat** or use the selector. GM and players.
  [unverified]
- Where it lives, which depends on UI state:
  - Sidebar expanded with chat as the active tab: inside the chat tab at the bottom
    (`#chat .chat-form`). [unverified]
  - Chat popout open: inside the popout window. [unverified]
  - Otherwise (sidebar collapsed, or another tab active): floating over the canvas at bottom
    right, inside `#chat-notifications`, with the mode buttons stacked vertically. It also
    stays embedded in the sidebar when **Chat Notifications** is set to **Notification Pip**
    or the window is too narrow. [unverified]
- Keys: Enter sends; Shift+Enter adds a new line; ArrowUp and ArrowDown step through your last
  16 sent messages, but only when the input is empty. [unverified]
- Formatting menu: a ProseMirror toolbar. In the floating position it is hidden until the input
  has focus. **Source HTML** (code icon) opens an HTML editor dialog with **Send Message** and
  **Save Changes** buttons. [unverified]
- Gotcha for automation: the editable node is a `contenteditable` div
  (`#chat-message .editor-content`). Click it before typing. Setting `.value` on the wrapper
  does not send anything. An error during sending (bad command, bad formula) shows as a red
  notification, and the text stays in the input. [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/tabs/chat/notifications.hbs`,
`C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs` (`_toggleNotifications`,
`_shouldShowNotifications`, `MAX_MESSAGE_HISTORY`),
`C:/FoundryTest/app/common/prosemirror/chat/chat-input-plugin.mjs`,
`C:/FoundryTest/app/common/prosemirror/chat/chat-menu-plugin.mjs`,
`C:/FoundryTest/app/public/css/foundry2.css` (chat input rules)

## Message visibility modes (formerly roll modes)

The selector is `#message-modes`: five icon buttons next to the input, in the chat tab's
bottom bar or stacked beside the floating input. The active button has
`aria-pressed="true"`. The value is stored per browser (`core.messageMode`, client scope), not
in the world. Default: `public`.

- **Public as User** (`public`, globe icon) - everyone sees the message; plain text posts
  out-of-character under your user name. GM and players. Reversible (click another mode).
  [unverified]
- **Private to Gamemasters** (`gm`, user-secret icon) - whispered to all GMs and visible to
  the sender. Applies to plain text too. [unverified]
- **Blind to Gamemasters** (`blind`, eye-slash icon) - whispered to the GMs with the blind flag
  set: a player who sends it cannot see their own result. Manual dice entry is never offered for
  blind rolls. [unverified]
- **Self Only** (`self`, user icon) - whispered to the sender only. [unverified]
- **Public as Character** (`ic`, hat-wizard icon) - new in v14. Plain text posts in-character
  as the current speaker, with a chat bubble over the token. Rolls sent in this mode are
  treated as public. It needs a speaker (a controlled token or an assigned character).
  Otherwise sending plain text fails with **You cannot chat in-character without an identified
  speaker** (an unlocalized error). A bug where nearly every post became a bubble (#14607) was
  fixed in 14.366. [unverified]
- Gotcha: the mode persists across reloads in that browser. A mode left on **Self Only** or
  **Blind to Gamemasters** makes later test messages look missing. Reset to **Public as User**
  at the end. [unverified]
- dnd5e roll dialogs have their own **Roll Mode** select. It offers the four non-IC modes and
  defaults to the chat mode, with IC mapped to public. [unverified]

Sources: `C:/FoundryTest/app/client/config.mjs` (`ChatMessage.modes`),
`C:/FoundryTest/app/client/documents/chat-message.mjs` (`applyMode`, `#resolveMode`),
`C:/FoundryTest/app/public/lang/en.json` (`CHAT.MODES.*`),
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`getMessageMode`,
`_prepareConfigurationContext`), https://foundryvtt.com/releases/14.355,
https://github.com/foundryvtt/foundryvtt/issues/14607, https://foundryvtt.com/article/dice/

## Chat commands

Commands are matched at the start of the message and need a space after the command word.
An unknown `/word` fails with **{command} is not a valid chat message command.** The patterns
live in `foundry.applications.sidebar.tabs.ChatLog.CHAT_COMMANDS`.

Dice commands (a formula, then optional `# flavor text`; each extra line that starts with the
same command, e.g. `/r 1d20` then `/r 1d6` on the next line, adds another roll to the same
message):

- `/r` or `/roll` - roll using the active mode. [unverified]
- `/gmr` or `/gmroll` - always **Private to Gamemasters**. [unverified]
- `/br`, `/broll`, `/blindr`, `/blindroll` - always **Blind to Gamemasters**, with no manual
  prompt. [unverified]
- `/sr`, `/sroll`, `/selfr`, `/selfroll` - always **Self Only**. [unverified]
- `/pr`, `/proll`, `/publicr`, `/publicroll` - always public. [unverified]
- Roll data: formulas can use `@path` values from the speaker's actor, or else from the user's
  assigned character (for example `@abilities.dex.mod` in dnd5e). A path that is missing
  silently becomes 0. [unverified]

Speech and whisper commands:

- `/ooc text` - out-of-character and always public (no speaker, user-colour border). [unverified]
- `/ic text` - in-character as the current speaker. Fails without a speaker (see above).
  [unverified]
- `/em text`, `/emote text`, `/me text` - an emote, shown as "<speaker name> text" with a chat
  bubble. Needs a speaker. [unverified]
- `/w name text` or `/whisper name text` - private message. For several recipients or names
  with spaces, use brackets: `/w [Name One, Name Two] text`. A target can be a user name, the
  name of a user's assigned character, `gm` or `dm` (all GMs), or `players` (all non-GM
  users). Unknown names fail with **No target users exist for this whisper. Check your
  spelling or try "/w [User Name]" instead.** [unverified]
- `/gm text` - whisper to all GMs. [unverified]
- `/players text` - whisper to all players. [unverified]
- `/reply text` - reply to the group from the last whisper you received. [unverified]
- Permission: whispering to non-GM users needs **Whisper Private Messages** (default role:
  Player). Without it: **You do not have permission to send whispered chat messages to other
  users.** [unverified]
- `/m name` or `/macro name [key=value ...]` - runs a macro by name or hotbar slot number and
  posts no message. It can run arbitrary code; avoid it in verification. [unverified]

dnd5e adds these commands through its `chatMessage` hook (matched on the whole message):

- `/check`, `/skill`, `/tool`, `/save`, `/concentration` - roll for the controlled tokens, or
  for the user's assigned character if none is controlled. Examples: `/save dex 15`,
  `/check acrobatics 12`. With no actor, a warning shows: **No selected or assigned actor could
  be found to execute this roll.** Adding `request` posts a roll-request card instead.
  [unverified]
- `/attack +5`, `/damage 2d6 fire`, `/heal 2d4+2` (also `/healing`) - roll attack, damage or
  healing. [unverified]
- `/award ...` - awards XP or currency to actors. It writes world data; avoid it. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs` (`CHAT_COMMANDS`,
`parse`, `processMessage`, `#processWhisperCommand`, `#processDiceCommand`),
`C:/FoundryTest/app/client/documents/chat-message.mjs` (`getWhisperRecipients`),
`C:/FoundryTest/app/common/constants.mjs` (`MESSAGE_WHISPER`),
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`VALID_CHAT_COMMANDS`, `chatMessage`,
`rollCheckSave`), https://foundryvtt.com/article/chat/, https://foundryvtt.com/article/dice/,
https://github.com/foundryvtt/dnd5e/wiki/Enrichers,
https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html

## Dice syntax basics

- `NdF` - N dice with F faces, e.g. `3d6` or `1d20`. The dice terms are `d` (die), `dc`
  (coin), and `dF` (Fate/Fudge). `d%` is not valid in v14 because `%` is the modulo operator;
  use `1d100`. [unverified]
- Arithmetic: `+ - * / %`, with parentheses for grouping, e.g. `(1d8+4)*2`. [unverified]
- Nested dice: `1d(1d20)`. [unverified]
- Pools: `{4d6, 3d8}kh` keeps the highest pool result. [unverified]
- Functions: any `Math` function, e.g. `floor(1d12/3)`, `max(1d20, 10)`. [unverified]
- Per-term flavor: `2d6[slashing]+1d8[fire]`. [unverified]
- Message flavor: `/r 1d20 # Perception`. [unverified]
- Check a formula without rolling: `Roll.validate("4d6kh3")` returns true or false. [unverified]

Sources: `C:/FoundryTest/app/client/dice/grammar.pegjs`,
`C:/FoundryTest/app/client/dice/terms/operator.mjs`,
`C:/FoundryTest/app/client/dice/terms/function.mjs`, `C:/FoundryTest/app/client/config.mjs`
(`Dice.terms`), https://foundryvtt.com/article/dice/, https://foundryvtt.com/article/dice-advanced/,
https://foundryvtt.com/api/v14/classes/foundry.dice.Roll.html

## Dice modifiers

Modifiers go straight after the die term, with no space. Comparisons use `=`, `<`, `<=`, `>`,
`>=`. With no comparison, the target is the die's maximum (for explode) or 1 (for reroll).

- `r` - reroll once when the result matches (default: 1). `1d20r1`, `1d20r<3`. [unverified]
- `rr` - keep rerolling while it matches. `1d20rr<3`. [unverified]
- `x` - explode: roll again on a match, recursively. `5d10x`, `5d10x>=9`. A number before the
  comparison caps the explosions: `6d10x5=10`. [unverified]
- `xo` - explode at most once per original die. `6d10xo10`. [unverified]
- `k` or `kh` - keep the highest (default 1); `kl` - keep the lowest. `4d6kh3`, `2d20kl`.
  [unverified]
- `d` or `dl` - drop the lowest (default 1); `dh` - drop the highest. `4d6d1`, `3d6dh`.
  [unverified]
- `min` and `max` - clamp each result. `4d10min2`, `4d10max8`. [unverified]
- `cs` - count successes (default: the maximum face). `10d20cs>10`. [unverified]
- `cf` - count failures (default: 1). `6d6cf<3`. [unverified]
- `df` - deduct failures from the success count. `5d10cs>=6df=1`. [unverified]
- `sf` - subtract the values of failed dice. `3d6sf<3`. [unverified]
- `ms` - margin of success: the total minus the target. `3d6ms>=10`. [unverified]
- `even` and `odd` - count even or odd results. `6d6even`. [unverified]
- `c` on coins - call heads (1) or tails (0). `1dcc1`. [unverified]
- dnd5e advantage in chat: `2d20kh + 5` (disadvantage: `2d20kl`). [unverified]

Sources: `C:/FoundryTest/app/client/dice/terms/die.mjs` (`MODIFIERS`, `explode`),
`C:/FoundryTest/app/client/dice/terms/pool.mjs`, `C:/FoundryTest/app/client/dice/terms/coin.mjs`,
https://foundryvtt.com/article/dice-modifiers/

## Inline rolls

- `[[formula]]` - an immediate roll. It is rolled once when the message is created and shown as
  a result chip with the formula as its tooltip. Click the chip to expand or collapse the dice.
  It never prompts for manual dice. [unverified]
- `[[/r formula]]` (and `[[/gmr ...]]`, `[[/br ...]]`, `[[/sr ...]]`, `[[/pr ...]]`) - a
  deferred roll. It shows as a button with a d20 icon. Each click posts a new roll message in
  that command's mode, or in the active mode for `/r`. The roll data comes from the sheet the
  button is in, if any, otherwise from the current speaker. [unverified]
- `[[...]]{Label}` - replaces the text shown on either kind. `# flavor` inside a deferred roll
  becomes the flavor of the posted message. [unverified]
- A formula ending in `]` (a flavor tag) needs three closing brackets: `[[1d6[fire]]]`.
  [unverified]
- dnd5e enrichers in chat or journal text: `[[/check dex 15]]`, `[[/save wis 13]]`,
  `[[/damage 2d6 fire]]`, `[[/attack +5]]`, `[[/item Name]]`, `[[/award ...]]`,
  `[[lookup @name]]`, and `&Reference[prone]`. They render as clickable links. [unverified]
- Gotcha: inline rolls are enriched when the message is saved (immediate results are fixed at
  that moment). Clicking a deferred inline roll creates a world document each time.
  [unverified]

Sources: `C:/FoundryTest/app/client/applications/ux/text-editor.mjs` (`_enrichInlineRolls`,
`_createInlineRoll`, `_onClickInlineRoll`), `C:/FoundryTest/app/client/documents/chat-message.mjs`
(`_preCreate`), `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`registerCustomEnrichers`),
https://foundryvtt.com/article/dice/, https://github.com/foundryvtt/dnd5e/wiki/Enrichers

## Message controls and context menu

Open the menu by right-clicking a message. Under dnd5e you can also left-click the
vertical-ellipsis button, **Additional Controls**, in the message header. The menu renders as
`#context-menu` with `li.context-item` entries. Entries show only when they apply.

- **Pop Out Message** - opens the message in its own small window (`.chat-popout`). Needs the
  `core.canPopout` flag, which dnd5e sets on every message it creates. GM and players.
  Reversible (close the window). [unverified]
- **Reveal To Everyone** - makes a whispered or blind message public by clearing the recipients
  and the blind flag. Shown to the GM or the author, only when they can see the content (so a
  player cannot reveal their own blind roll). Changes world data. Undo with **Make Private**,
  which does not restore the original recipient list. [unverified]
- **Make Private** - whispers a public message to all GMs. Same visibility rule. Changes world
  data. Undo with **Reveal To Everyone**. [unverified]
- **Delete** - deletes that one message at once, with no confirmation. Shown to the GM and to
  the author (the owner). Not reversible. [unverified]
- Trash icon in the message header (**Delete**) - the same action. Core shows it only to GMs,
  and dnd5e also removes it for non-GMs. No confirmation. Not reversible. [unverified]
- dnd5e entries on roll messages when at least one token is controlled: **Apply As Damage**,
  **Apply As Healing**, **Apply As Temporary HP**, **Apply Double As Damage**, **Apply Half As
  Damage**. These apply the roll total to the actors of the controlled tokens (not the
  targets), taking resistances into account. They change actor HP (world data); to undo, apply
  the opposite entry or edit HP. [unverified]
- dnd5e attack-roll entries: **Select Hit Targets** and **Select Missed Targets**, which change
  the token selection only. Usage-card entries: **Select All Outcomes**, **Select Successes**,
  **Select Failures**. [unverified]
- Secret blocks inside a message: toggling reveal on one saves the message content (world
  data). [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs`
(`_getEntryContextOptions`), `C:/FoundryTest/app/common/documents/chat-message.mjs`
(delete permission `OWNER`), `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`
(`addChatMessageContextOptions`, `_enrichChatCard`, `canApplyDamage`, `applyChatCardDamage`),
`C:/FoundryTest/app/client/applications/ux/context-menu.mjs`, https://foundryvtt.com/article/chat/

## Speaker selection (token vs user)

v14 core has no speaker dropdown. The speaker is picked for each message, in this order:

1. The first token you control on the viewed scene: its name becomes the alias, and its actor
   provides the roll data. [unverified]
2. Otherwise, your assigned character (set in **User Configuration**): its active token on the
   scene if it has one, else the actor. [unverified]
3. Otherwise, your user name. [unverified]

- To change speaker: click a token on the canvas to control it. Click empty canvas to release
  it and fall back to your character or user. GM and players (players only for tokens they
  own). UI state only. [unverified]
- Out-of-character messages (`/ooc`, and plain text in the non-IC modes) always show the user
  name, whatever token is controlled. [unverified]
- In-character messages (`/ic`, emotes, **Public as Character**) need a speaker and show a chat
  bubble over the token when **Enable Chat Bubbles** is on. [unverified]
- Check the current speaker without posting: `ChatMessage.implementation.getSpeaker()`.
  [unverified]

Sources: `C:/FoundryTest/app/client/documents/chat-message.mjs` (`getSpeaker`, `alias`,
`speakerActor`), `C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs`
(`#processChatCommand`), https://foundryvtt.com/article/chat/

## Export, clear, popout and notifications

- **Export Chat Log** (floppy-disk icon) - downloads every message as plain text
  (`fvtt-log-<date>.txt`) through the browser. GM only. Visible only when the input is embedded
  (sidebar chat tab or popout), not in the floating position. Changes nothing in the world, but
  it is a file download: ask the user before clicking. [unverified]
- **Clear Chat Log** (trash icon) - opens a dialog titled **Flush Chat Log**:
  **Are You Sure?** **All messages within the chat log will be permanently deleted.** with
  **Yes** and **No**. **No** is the default button (Enter picks **No**). **Yes** deletes every
  message and cannot be undone. GM only. Same visibility rule as Export. [unverified]
- Chat popout - right-click the **Chat Messages** tab. A window titled **Chat Log** opens with
  its own log and the input. Close it with the window's close button. UI only. [unverified]
- Notification cards - when the chat tab is not visible, new messages also appear as floating
  cards over the canvas (`#chat-notifications`). They fade after about 5 s; hovering pauses
  them. **Dismiss** (x) closes one early. Gotcha: while a card is showing, the same message
  exists twice in the DOM (log plus card), so scope selectors to `#chat` or
  `#chat-notifications`. [unverified]
- Notification pip - a dot on the chat tab. It is used instead of cards when **Chat
  Notifications** is set to **Notification Pip**, or when there is no room for cards.
  [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/tabs/chat/notifications.hbs`,
`C:/FoundryTest/app/client/documents/collections/chat-messages.mjs` (`export`, `flush`),
`C:/FoundryTest/app/client/applications/api/dialog.mjs` (`confirm` defaults),
`C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs` (`_toggleNotifications`,
`NOTIFY_DURATION`), https://foundryvtt.com/article/chat/

## Dice configuration and manual dice (v12+, extended in v14)

- **Dice** - path: Sidebar > **Settings** tab > **Game Settings** > **Core** category > row
  **Dice** > button **Dice**. It opens the **Dice Configuration** window. GM and players (not
  restricted). Stored per browser (client scope). Reversible. [unverified]
- **Default Method** - a select whose blank option is **Foundry VTT Digital Roll**. Choices:
  **Digital Roll (Mersenne Twister)** and **Manual Input**. Modules can add more (e.g. Bluetooth
  dice). [unverified]
- Per-die rows **d4**, **d6**, **d8**, **d10**, **d12**, **d20**, **d100** - each a select whose
  blank option is **Use Default**. Save with **Save Changes**. [unverified]
- **Manual Input** is offered only to users with **Make Manual Rolls** (default role: Trusted
  Player; GMs have it). The default Player role does not see it. [unverified]
- Manual flow: a roll that uses a manual die opens the **Roll Resolution** window. It shows the
  formula and one number box per die, with a **Submit Rolls** button. Boxes left empty are
  filled with digital results. Closing the window also finishes the roll digitally. Extra dice
  from rerolls or explosions show up as new rows, each with its own **Submit Roll** arrow
  button. [unverified]
- No prompt: blind rolls, immediate inline rolls `[[...]]`, and minimized or maximized rolls.
  [unverified]
- Gotcha: while **Manual Input** is active, every roll in that browser (sheet rolls included)
  waits on the resolver window, which can stall an automated run. Always set the method back to
  the blank default when finished. [unverified]

Sources: `C:/FoundryTest/app/client/applications/settings/menus/dice-config.mjs`,
`C:/FoundryTest/app/templates/settings/menus/dice-config.hbs`,
`C:/FoundryTest/app/client/applications/dice/roll-resolver.mjs`,
`C:/FoundryTest/app/templates/dice/roll-resolver.hbs`,
`C:/FoundryTest/app/client/dice/roll.mjs` (`resolverImplementation`, `_evaluate`),
`C:/FoundryTest/app/client/config.mjs` (`Dice.fulfillment`),
`C:/FoundryTest/app/common/constants.mjs` (`MANUAL_ROLLS`),
https://foundryvtt.com/article/dice-advanced/, https://foundryvtt.com/releases/14.355

## Related settings

Core, in Sidebar > **Settings** > **Game Settings** > **Core**:

- **Enable Chat Bubbles** - checkbox; shows bubbles over tokens for in-character messages and
  emotes. Per browser. Reversible. [unverified]
- **Pan to Token Speaker** - checkbox; pans the camera to a token when it shows a bubble. Per
  browser. Reversible. [unverified]
- **User Interface** button (the row is titled **User Interface Configuration**) >
  **Chat Background**: draws the log on a solid background. Same window > **Chat
  Notifications**: **Chat Cards** or **Notification Pip**. Per browser. Reversible.
  [unverified]

dnd5e, in the same window > **Dungeons & Dragons Fifth Edition** category:

- **Summary Chat Cards** - appends some results (e.g. saves) to the originating card instead of
  posting full cards. Per browser. [unverified]
- **Collapse Item Cards in Chat** - per browser. [unverified]
- **Collapse Trays in Chat** - choices: **Collapse All**, **Collapse Older Trays**,
  **Collapse After Use**, **Never Collapse**. Per browser. [unverified]
- **Chat Log Theme** - **Default**, **Light** or **Dark**. Per browser. [unverified]
- **Allow Player Damage Application** - world setting, GM only. When off, only GMs see the
  damage tray. [unverified]
- **Visibility** row, button **Configure Visibility** (GM only). It contains **Attack Result
  Visibility** (default **Hide all**), **Challenge Visibility** (default **Show only from other
  players**) and **Conceal NPC Descriptions**. These are world settings. [unverified]

Sources: `C:/FoundryTest/app/client/game.mjs` (`chatBubbles`, `chatBubblesPan`),
`C:/FoundryTest/app/client/applications/settings/menus/ui-config.mjs`,
`C:/FoundryTest/app/client/applications/settings/config.mjs`,
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (settings registration),
`C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`, https://foundryvtt.com/article/chat/

## dnd5e chat cards and roll dialogs (summary)

- Usage card (message type `usage`) - posted when an item or activity is used. The header shows
  the item image and name; clicking the header toggles the description, and clicking the image
  opens the item. Below that: property pills, a recorded-targets row, and icon-only action
  buttons named by tooltip, such as **Attack**, **Damage**, a save button like
  **DC 13 Dexterity Saving Throw**, **Place Measured Template**, **Consume Resource** and
  **Refund Resource**. Clicking a roll button opens a roll dialog. [unverified]
- Roll dialog - a d20 roll has **Advantage**, **Normal** and **Disadvantage** buttons; a damage
  roll has **Critical Hit** and **Normal** (or **Roll**). The **Configuration** section has a
  **Roll Mode** select; each formula has a **Situational Bonus?** field. Holding Shift skips the
  dialog (normal roll), Alt rolls with advantage, Ctrl with disadvantage. [unverified]
- Attack card (type `attack`) - the d20 total plus target pills. Hit/miss and AC are shown to
  players according to **Attack Result Visibility**; GMs always see them. [unverified]
- Damage card (type `damage`) - total, a breakdown popover on click, and a tray headed
  **Apply** (GM, or players when **Allow Player Damage Application** is on). The tray has a
  target-source toggle (**Targeted** or **Selected**; disabled when nothing was targeted at roll
  time), multiplier buttons -1, 0, 1/4, 1/2, 1, 2, per-target pills, and an **Apply** button.
  **Apply** changes the HP of owned target tokens (world data). With no targets it shows
  **No Targets**. [unverified]
- Save and check cards (types `save`, `check`) - the result against the DC, if one was set. DCs
  and success highlighting follow **Challenge Visibility** for players. [unverified]
- Request/prompt card (type `prompt`) - from `/save dex 15 request` or a `request` enricher.
  Players click the buttons to roll for their own characters. [unverified]
- Effect tray (`effect-application`) on usage cards - applies an item's effects to targets
  (world data). [unverified]

Sources: `C:/FoundryTest/data/Data/systems/dnd5e/templates/chat/` (`usage-card.hbs`,
`attack-card.hbs`, `damage-card.hbs`, `save-card.hbs`, `parts/card-face.hbs`,
`parts/card-buttons.hbs`), `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`
(`DamageApplicationElement`, `RecordedTargetsElement`, `D20RollConfigurationDialog`,
`DamageRollConfigurationDialog`, `_usageChatButtons`, keybindings `skipDialog*`),
`C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`,
https://github.com/foundryvtt/dnd5e/wiki/Enrichers

## Driving it from automation

Read-only console checks (none of these create, update or delete documents):

```js
// Sidebar and chat UI state (v14: there is no ui.sidebar.activeTab)
ui.sidebar.expanded;                       // true when the sidebar is open
ui.sidebar.tabGroups.primary;              // "chat" when the chat tab is active
ui.chat.active;                            // same, as a boolean
!!ui.chat.popout?.rendered;                // chat popout open?
document.getElementById("chat-message")?.closest("#chat-notifications") ? "floating" : "embedded";
ui.chat.isAtBottom;

// Message mode
game.settings.get("core", "messageMode");  // "public" | "gm" | "blind" | "self" | "ic"
document.querySelector('#message-modes [aria-pressed="true"]')?.dataset.mode;
Object.keys(CONFIG.ChatMessage.modes);

// Commands: parse without sending (returns [commandKey, match, fn])
Object.keys(foundry.applications.sidebar.tabs.ChatLog.CHAT_COMMANDS);
foundry.applications.sidebar.tabs.ChatLog.parse("/gmr 1d20")[0];   // "gmroll"
foundry.applications.sidebar.tabs.ChatLog.parse("/foo")[0];        // "invalid"

// Last message and its visibility
const m = game.messages.contents.at(-1);
({ id: m?.id, alias: m?.alias, whisper: m?.whisper, blind: m?.blind, style: m?.style,
   rolls: m?.rolls.map(r => `${r.formula}=${r.total}`), type: m?.type,
   canPopout: m?.getFlag("core", "canPopout") });
game.messages.size;

// Speaker and whisper targets
ChatMessage.implementation.getSpeaker();
canvas.tokens?.controlled.map(t => t.name);
game.user.character?.name;
ChatMessage.getWhisperRecipients("gm").map(u => u.name);

// Dice
Roll.validate("4d6kh3");
game.settings.get("core", "diceConfiguration");     // {} means all defaults
game.user.can("MANUAL_ROLLS"); game.user.can("MESSAGE_WHISPER");
// Evaluates in memory only, posts nothing:
(await new Roll("2d6+3").evaluate({ allowInteractive: false })).total;

// Open windows and context menu
[...foundry.applications.instances.values()].map(a => `${a.constructor.name}#${a.id}`);
[...document.querySelectorAll("#context-menu .context-item")].map(e => e.textContent.trim());

// Settings
game.settings.get("core", "uiConfig").chatNotifications;   // "cards" | "pip"
game.settings.get("core", "chatBubbles");
game.settings.get("dnd5e", "allowPlayerDamageTray");
game.settings.get("dnd5e", "attackRollVisibility");
game.settings.get("dnd5e", "challengeVisibility");
```

Stable selectors and accessible names for an accessibility-tree search:

| Element | Accessible name / text | Selector |
| --- | --- | --- |
| Chat tab button | **Chat Messages** | `#sidebar-tabs [data-tab="chat"]` |
| Sidebar toggle | **Expand** / **Collapse** | `#sidebar-tabs [data-action="toggleState"]` |
| Chat input | **Chat** | `#chat-message .editor-content` |
| Mode buttons | **Public as User**, **Private to Gamemasters**, **Blind to Gamemasters**, **Self Only**, **Public as Character** | `#message-modes button[data-mode="public"]` (gm, blind, self, ic) |
| Export (GM) | **Export Chat Log** | `#chat-controls [data-action="export"]` |
| Clear (GM) | **Clear Chat Log** | `#chat-controls [data-action="flush"]` |
| Jump to bottom | **Jump to Bottom** | `.chat-form .jump-to-bottom` |
| Message | (sender name) | `#chat li.message[data-message-id]` |
| Message delete (GM) | **Delete** | `li.message .message-delete` |
| dnd5e menu button | **Additional Controls** | `li.message .chat-control[data-context-menu]` |
| Context menu | entry text | `#context-menu .context-item` |
| Notification card close | **Dismiss** | `#chat-notifications .message-dismiss` |
| Clear confirm | **Flush Chat Log**, **Yes**, **No** | dialog buttons `[data-action="yes"]`, `[data-action="no"]` |
| Dice settings | **Dice Configuration**, **Default Method**, **Save Changes** | `#dice-config` |
| Manual roll window | **Roll Resolution**, **Submit Rolls** | `.roll-resolver` |
| Chat popout | **Chat Log** | `#chat-popout` |

Driving gotchas:

- Check where the input is (floating or embedded) before looking for the GM buttons; they
  exist only when it is embedded. [unverified]
- Type into the contenteditable, then press Enter. Wait for `game.messages.size` to go up
  instead of sleeping. [unverified]
- The context menu appears on `contextmenu` (right-click). Some drivers need the pointer
  inside the message's `li`, not on the roll button. [unverified]
- Commands only match at the very start of the message. A leading space or an empty first
  paragraph turns the command into plain text. [unverified]

## Safety in the test world

Only in the local test world (`ai-tool-test` on `localhost:30001`, user **Claude**). Never
drive chat in the live campaign.

Changes world data (ChatMessage or Actor documents):

- Sending any message, roll or whisper, and clicking a deferred inline roll. Undo: delete the
  message (trash icon or **Delete**).
- **Delete** and the trash icon: remove a message with no confirmation. Cannot be undone.
- **Clear Chat Log** then **Yes**: removes every message. Cannot be undone. In verification,
  click **No** only.
- **Reveal To Everyone** and **Make Private**: update visibility. Each undoes the other, but
  the original recipient list is lost.
- dnd5e **Apply As ...** entries, the damage-tray **Apply** button, effect trays,
  **Consume Resource** / **Refund Resource**, **Place Measured Template**, and `/award`: change
  actors or create scene documents. Undo by applying the opposite effect or editing the sheet.
  Only use a throwaway token.
- `/macro` (`/m`): runs arbitrary code. Do not use it.

Browser-only (safe, but reset afterwards): the message mode, **Dice Configuration**, **Enable
Chat Bubbles**, **Pan to Token Speaker**, the UI settings, and dnd5e client settings.

Needs the user's explicit permission: **Export Chat Log** (a file download).

Cleanup habit: put `verify` in every test message or roll flavor (e.g. `/r 1d20 # verify`), so
the cleanup pass can find the messages and delete them one by one with the trash icon. Reset the
mode to **Public as User** and **Dice Configuration** to the defaults before finishing.

## Verification checklist

Log in as **Claude** (GM) in `ai-tool-test` unless the step says otherwise. Add `verify` to
every test message.

1. Load the world. Expected: the sidebar is collapsed, and the chat input with five stacked
   mode buttons floats at the bottom right of the canvas. `ui.sidebar.expanded` is `false`.
2. Click the sidebar tab **Chat Messages**. Expected: the sidebar expands on the chat log, the
   input moves to the bottom of the tab, the mode buttons sit in a row, and **Export Chat Log**
   and **Clear Chat Log** appear.
3. Hover each mode button. Expected tooltips, in order: **Public as User**, **Private to
   Gamemasters**, **Blind to Gamemasters**, **Self Only**, **Public as Character**; the first
   has `aria-pressed="true"`.
4. Click the input (**Chat**), type `hello verify`, press Enter. Expected: an out-of-character
   message from **Claude** with a user-colour border.
5. With the input empty, press ArrowUp. Expected: `hello verify` comes back. Clear the input.
6. Send `/r 1d20 # verify`. Expected: a roll message with flavor "verify" and a total from 1
   to 20, with **Claude** as the speaker (no token controlled).
7. Click the roll in that message. Expected: the per-die breakdown expands or a breakdown
   popover opens.
8. Send `/r 4d6kh3 # verify`. Expected: four dice shown, one marked as discarded; the total is
   the sum of three.
9. Send `/gmr 1d20 # verify`. Expected: `whisper` on the last message lists the GM user ids
   (console check) and `blind` is false.
10. Send `/br 1d20 # verify`. Expected: the GM sees the result; `blind` is true.
11. Send `/sr 1d20 # verify`. Expected: `whisper` equals Claude's id only.
12. Send `/pr 1d20 # verify`. Expected: `whisper` is empty.
13. Click **Private to Gamemasters**, then send `mode verify`. Expected: the plain text message
    is whispered to the GMs (header shows **To**:). Click **Public as User** again.
14. With no token controlled and no assigned character, click **Public as Character** and send
    `ic verify`. Expected: an error notification about an in-character message without an
    identified speaker; nothing is posted. Click **Public as User**.
15. Send `/w gm whisper verify`. Expected: a whisper to all GM users.
16. Send `/w [Player] whisper verify`. Expected: a whisper whose **To**: line names Player.
17. Send `/w nobody verify`. Expected: the error **No target users exist for this whisper...**;
    the text stays in the input. Clear it.
18. Send `/foo verify`. Expected: the error **/foo is not a valid chat message command.**
19. Send `/ooc ooc verify`. Expected: a public out-of-character message.
20. Send `inline [[2d6+3]] verify`. Expected: a result chip; clicking it expands the dice.
21. Send `deferred [[/r 1d20+2 # verify]]{Test roll} verify`. Expected: a **Test roll** button
    with a d20 icon. Click it. Expected: a new roll message with flavor "verify".
22. Right-click a public test message. Expected menu: **Pop Out Message**, **Make Private**,
    **Delete** (no **Apply As ...** entries while no token is controlled).
23. Click **Pop Out Message**. Expected: a small window showing just that message. Close it.
24. Right-click the same message and click **Make Private**. Expected: it becomes a GM whisper.
    Right-click again and click **Reveal To Everyone**. Expected: public again.
25. Click the vertical-ellipsis **Additional Controls** in a message header. Expected: the same
    context menu opens.
26. Click the trash icon (**Delete**) on one verify message. Expected: it disappears at once,
    with no dialog.
27. Hover **Export Chat Log** and confirm the tooltip. Do not click it unless the user has
    approved a file download.
28. Click **Clear Chat Log**. Expected: a **Flush Chat Log** dialog with **Yes** and **No**.
    Click **No**. Expected: no messages are removed (`game.messages.size` unchanged).
29. Right-click the **Chat Messages** tab. Expected: a **Chat Log** popout window, with the input
    inside it. Close the popout. Expected: the input returns to the sidebar.
30. Click **Collapse** on the sidebar strip. Expected: the input floats over the canvas again,
    and **Export Chat Log** and **Clear Chat Log** are hidden.
31. Click the canvas, then press Shift+C. Expected: the sidebar expands on chat and the input has
    focus.
32. Sidebar > **Settings** > **Game Settings** > **Core**. Expected: a **Dice** row with a
    **Dice** button, and checkboxes **Enable Chat Bubbles** and **Pan to Token Speaker**.
33. Click the **Dice** button. Expected: a **Dice Configuration** window with **Default
    Method** (blank option **Foundry VTT Digital Roll**) and rows d4 to d100 (**Use Default**).
34. Set **d20** to **Manual Input** and click **Save Changes**. Send `/r 1d20 # verify`.
    Expected: a **Roll Resolution** window with one d20 box. Enter 17 and click **Submit
    Rolls**. Expected: a roll message with total 17.
35. With d20 still manual, send `/br 1d20 # verify`. Expected: no **Roll Resolution** window.
36. Reopen **Dice Configuration**, set **d20** back to **Use Default**, and save. Expected:
    `game.settings.get("core","diceConfiguration").d20` is `""`.
37. In **Game Settings** > **Core**, click **User Interface**. Expected: **Chat Background**
    and **Chat Notifications** (**Chat Cards** / **Notification Pip**) are present. Close the
    window without saving.
38. In **Game Settings**, open the dnd5e category. Expected: **Summary Chat Cards**, **Collapse
    Trays in Chat**, **Chat Log Theme**, **Allow Player Damage Application**, and a
    **Visibility** row with **Configure Visibility**. Close without saving.
39. (Needs a throwaway token for a dnd5e actor on the active scene.) Control the token and
    send `/save dex 15`. Expected: a dnd5e roll dialog with **Advantage** / **Normal** /
    **Disadvantage** and a **Roll Mode** select. Click **Normal**. Expected: a save card
    showing the result against DC 15.
40. With the same token controlled, send `/damage 2d6 fire`. Expected: a damage card with a
    total and an **Apply** tray (GM).
41. Right-click that damage card. Expected: **Apply As Damage**, **Apply As Healing**, **Apply
    As Temporary HP**, **Apply Double As Damage**, **Apply Half As Damage**. Close the menu
    without clicking (or apply damage and then healing to a full-HP token to restore it).
42. With the token still controlled and **Public as User** active, send `token verify`.
    Expected: an out-of-character message under **Claude**, not the token name. Then click
    **Public as Character** and send `ic verify`. Expected: an in-character message under the
    token's name and a chat bubble over the token. Click **Public as User**.
43. Release all tokens (click empty canvas) with no assigned character, then send
    `/save dex 15`. Expected: the warning **No selected or assigned actor could be found to
    execute this roll.**
44. (Player view, separate session) Join as **Player**. Expected: the Claude `/gmr` and `/br`
    messages show as **Claude privately rolled some dice** with hidden totals, and the
    Claude-to-GM text whisper from step 15 is not shown at all.
45. As **Player**, open **Game Settings** > **Core** > **Dice**. Expected: no **Manual Input**
    choice (the Player role lacks **Make Manual Rolls**).
46. As **Player**, right-click one of Player's own messages. Expected: **Delete** is present;
    there is no trash icon in the header.
47. Cleanup as **Claude**: delete every message containing `verify` with the trash icon, set
    the mode to **Public as User**, and confirm `game.settings.get("core","diceConfiguration")`
    has no manual entries.

## Sources

Official (foundryvtt.com):

- https://foundryvtt.com/article/chat/ (older text: dropdown roll-mode selector, says `/roll` is
  always public)
- https://foundryvtt.com/article/dice/
- https://foundryvtt.com/article/dice-advanced/
- https://foundryvtt.com/article/dice-modifiers/
- https://foundryvtt.com/releases/14.355 (message visibility modes, `CHAT_COMMANDS`, dice
  default method)
- https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html
- https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html
- https://foundryvtt.com/api/v14/classes/foundry.dice.Roll.html
- https://github.com/foundryvtt/foundryvtt/issues/14607 (Public as Character bubbles, fixed in
  14.366)

dnd5e:

- https://github.com/foundryvtt/dnd5e/wiki/Enrichers (up to date for 6.0.0; the chat commands
  are the same syntax without brackets)

Community (lead only):

- https://foundryvtt.wiki/en/basics/Chat (the page did not render for the fetch tool; nothing
  on this page depends on it)

Local v14 install (ground truth, read-only):

- `C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar-tab.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/apps/chat-popout.mjs`
- `C:/FoundryTest/app/client/documents/chat-message.mjs`
- `C:/FoundryTest/app/common/documents/chat-message.mjs`
- `C:/FoundryTest/app/client/documents/collections/chat-messages.mjs`
- `C:/FoundryTest/app/client/config.mjs`
- `C:/FoundryTest/app/client/game.mjs`
- `C:/FoundryTest/app/client/dice/roll.mjs`, `C:/FoundryTest/app/client/dice/grammar.pegjs`,
  `C:/FoundryTest/app/client/dice/terms/*.mjs`
- `C:/FoundryTest/app/client/applications/dice/roll-resolver.mjs`
- `C:/FoundryTest/app/client/applications/settings/menus/dice-config.mjs`,
  `C:/FoundryTest/app/client/applications/settings/menus/ui-config.mjs`,
  `C:/FoundryTest/app/client/applications/settings/config.mjs`
- `C:/FoundryTest/app/client/applications/ux/text-editor.mjs`,
  `C:/FoundryTest/app/client/applications/ux/context-menu.mjs`
- `C:/FoundryTest/app/client/applications/api/dialog.mjs`
- `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`
- `C:/FoundryTest/app/common/prosemirror/chat/chat-input-plugin.mjs`,
  `C:/FoundryTest/app/common/prosemirror/chat/chat-menu-plugin.mjs`
- `C:/FoundryTest/app/common/constants.mjs`
- `C:/FoundryTest/app/templates/sidebar/chat-message.hbs`,
  `C:/FoundryTest/app/templates/sidebar/tabs/chat/*.hbs`,
  `C:/FoundryTest/app/templates/sidebar/tabs.hbs`,
  `C:/FoundryTest/app/templates/dice/*.hbs`,
  `C:/FoundryTest/app/templates/settings/menus/dice-config.hbs`,
  `C:/FoundryTest/app/templates/settings/config-category.hbs`
- `C:/FoundryTest/app/public/lang/en.json`, `C:/FoundryTest/app/public/css/foundry2.css`
- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`,
  `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`,
  `C:/FoundryTest/data/Data/systems/dnd5e/templates/chat/`,
  `C:/FoundryTest/data/Data/systems/dnd5e/templates/dice/`
