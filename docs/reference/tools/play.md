---
description: Every tool in the Play set with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Play tools

Run the table live: tokens, combat turns, rolls, damage, conditions, resources, chat, scene mood, map notes and loot. Part of the [tool reference](../tools.md); [Tool sets](../TOOL-SETS.md) explains how Claude Desktop loads the sets. Claude Desktop entry: `foundry-mcp-play`.

## use-item

Direct write. Use an item on a character (cast a spell, use an ability or feature, consume an item). Opens the item dialog in Foundry for the GM to confirm; on a GM browser without a canvas no dialog opens and the chat card Attack button reads the targets of whoever clicks it. Targets are optional. A slot spell with no slot at its level is cast at the lowest higher slot; with no slot left it is refused and nothing is used. Otherwise returns "initiated" at once. Find items with get-character or search-character-items first.

Kind: changes something and can delete or overwrite. Title: Use item.

Parameters:

- `actorIdentifier` (string, required): Character using the item (name or ID)
- `itemIdentifier` (string, required): Item name or ID (spell, feat, equipment, consumable, etc.)
- `targets` (array of string): Target character/token names or IDs. Use ["self"] to target the caster. If omitted, GM selects targets in Foundry.
- `consume` (boolean): Whether to consume charges/uses (default: true)
- `spellLevel` (integer): For spells: cast at a higher level than base (D&D 5e upcasting)
- `rollAttack` (boolean): D&D 5e: also roll the item's attack at once, with no dialog, against the targets. Needs at least one target. Errors when the item has no usable attack.

## switch-scene

Direct write. Switch to a different Foundry VTT scene by name or ID

Kind: changes something. Title: Switch scene.

Parameters:

- `scene_identifier` (string, required): Scene name or ID to switch to
- `optimize_view` (boolean): Automatically optimize the view for the scene. Default: `true`.

## request-player-rolls

Direct write. Request dice rolls from players: posts roll buttons in Foundry chat that players click. Ask the user first whether the roll is public (everyone sees it) or private (player and GM only) unless they already said. Finds the player from the character; falls back to the GM.

Kind: changes something. Title: Request player rolls.

Parameters:

- `rollType` (string, required): Type of roll to request (ability, skill, save, attack, initiative, custom). One of: `ability`, `skill`, `save`, `attack`, `initiative`, `custom`.
- `rollTarget` (string, required): An ability (str, dex, con, int, wis, cha), a skill (perception, stealth, ...) or a custom roll formula
- `targetPlayer` (string, required): Player name or character name to request the roll from
- `isPublic` (boolean, required): true: everyone sees the roll. false: only the target player and GM.
- `userConfirmedVisibility` (boolean, required): Must be true. Set it only when the user said "public" or "private" or answered your question about it. Always `true`.
- `rollModifier` (string): Optional modifier to add to the roll (e.g., "+2", "-1", "+1d4"). Default: `""`.
- `flavor` (string): Optional flavor text to describe the roll context. Default: `""`.
- `dc` (integer)
- `advantage` (string): One of: `advantage`, `disadvantage`.

## request-ability-check

Direct write. Request an ability check from a player, posting a clickable roll button to their chat. Shows the DC when provided. Use for checks like "Perception check to notice the ambush".

Kind: changes something. Title: Request ability check.

Parameters:

- `targetPlayer` (string, required): Player name or character name to request the roll from.
- `ability` (string, required): Ability to check. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `dc` (integer): Optional difficulty class to display with the request.
- `isPublic` (boolean, required): Whether the roll is public (visible to all) or private (target player + GM only).
- `reason` (string): Context for the check, e.g. "Perception check to notice the ambush".
- `advantage` (string): One of: `advantage`, `disadvantage`.

## request-attack-roll

Direct write. Request an attack roll for a specific weapon or spell from a player, posting a clickable roll button to their chat.

Kind: changes something. Title: Request attack roll.

Parameters:

- `targetPlayer` (string, required): Player name or character name to request the roll from.
- `weaponOrSpellName` (string, required): Name of the weapon or spell attack.
- `isPublic` (boolean, required): Whether the roll is public (visible to all) or private (target player + GM only).
- `advantage` (string): One of: `advantage`, `disadvantage`.

## roll-npc-check

Direct write. Roll for an NPC actor with no player prompt and post the result to chat: ability check, saving throw, skill check or attack.

Kind: changes something. Title: Roll NPC check.

Parameters:

- `actorName` (string, required): NPC actor name or ID.
- `rollType` (string, required): Type of roll. One of: `ability`, `save`, `skill`, `attack`.
- `rollTarget` (string, required): Target for the roll: ability (str/dex/...), skill name (perception, stealth, ...), or weapon/attack name.
- `isPublic` (boolean, required): Whether the result is public (true) or whispered to the GM (false).
- `advantage` (string): One of: `advantage`, `disadvantage`.

## plan-scene-restore

Plan putting a scene's walls, lights, tiles and tokens back from a backup copy of the world, after the map was broken by hand. Counts what is added back, removed, moved or changed. Over 200 changes: plans a batch, apply and plan again. Apply with apply-planned-change, revert with undo-change. Needs the module switch "Scene restore" on (off by default).

Kind: read-only. Title: Plan scene restore from backup.

Parameters:

- `scene` (string): Default: the viewed scene.
- `backupPath` (string): Restored world folder. Default: the Plan B folder.
- `parts` (array of string): One of: `walls`, `lights`, `tiles`, `tokens`.
- `recentCopyOk` (boolean): True for a hand-made copy: skips the changed-under-5-minutes refusal.

## plan-npc-turn

Plan a monster's turn. Without moveTo it only reads the fight: speed, attacks, Multiattack text, and each enemy's distance, AC, HP, state and score. With moveTo (a grid square) it paths round walls, doors and creatures, counts difficult terrain and plans the move (apply-planned-change, undo-change). List a multiattack in attacks (activity for a save action; legendary actions only on another creature's turn). Roll first with the tools the steps name, then call again with moveTo and results: one plan holds the move and all damage. Needs the "NPC turn assistant" switch (off by default).

Kind: read-only. Title: Plan NPC turn.

Parameters:

- `token` (string): NPC token. Default: whose turn it is.
- `moveTo` (object): Move the NPC to this grid square (its top-left square).
  - `gridX` (integer, required): Range: at least 0.
  - `gridY` (integer, required): Range: at least 0.
- `itemName` (string): Attack or action to use.
- `target` (string): Token to attack.
- `attacks` (array of object): A multiattack, in order. Items: at most 10.
  - `itemName` (string, required)
  - `target` (string, required)
  - `activity` (string): Activity of the item.
- `results` (array of object): Per damageByType entry. multiplier 0.5 = half on a made save. Items: 1 to 20.
  - `target` (string, required)
  - `amount` (number, required): The damage the roll reported. Range: at least 0.
  - `damageType` (string)
  - `multiplier` (number): Range: 0 to 1.
- `dash` (boolean): Dash: twice the speed; no attacks unless reason names a bonus-action Dash.
- `reason` (string): Why (shown in the plan).

## plan-paper-sync

After a paper night: plan the numbers on one paper sheet as one guarded change for that character (apply-planned-change, undo-change; needs the "AI Tool: Paper sync (writes)" switch, off by default). Compare with get-character first. Every value is the absolute number on the sheet now. Only differing fields change; a value above the maximum refuses the whole request and lists every problem. Quantity 0 removes an item (destructive: second confirm). Never changes XP (milestones), level, class or max HP. D&D 5e only. Not for player chat: it shows more than players see.

Kind: read-only. Title: Plan paper sheet sync.

Parameters:

- `actor` (string, required): The player character: name or id.
- `hp` (integer): Current hit points. Range: at least 0.
- `tempHp` (integer): Range: at least 0.
- `slots` (object): Spell slots left by level "1" to "9", and "pact".
  - `1` (integer): Range: at least 0.
  - `2` (integer): Range: at least 0.
  - `3` (integer): Range: at least 0.
  - `4` (integer): Range: at least 0.
  - `5` (integer): Range: at least 0.
  - `6` (integer): Range: at least 0.
  - `7` (integer): Range: at least 0.
  - `8` (integer): Range: at least 0.
  - `9` (integer): Range: at least 0.
  - `pact` (integer): Range: at least 0.
- `hitDice` (array of object): Hit dice left per class (class may be left out with one class).
  - `class` (string)
  - `left` (integer, required): Range: at least 0.
- `resources` (array of object): Class resources and item uses left ("Ki Points", "Wand of Fireballs").
  - `name` (string, required)
  - `value` (integer, required): Range: at least 0.
- `coins` (object): Coins now; leave out the unchanged ones.
  - `pp` (integer): Range: at least 0.
  - `gp` (integer): Range: at least 0.
  - `ep` (integer): Range: at least 0.
  - `sp` (integer): Range: at least 0.
  - `cp` (integer): Range: at least 0.
- `exhaustion` (integer): Level 0 to 6. Range: at least 0.
- `conditions` (array of string): The exact set now (empty clears them); leave out to keep them.
- `inspiration` (boolean)
- `resetDeathSaves` (boolean): true: successes and failures to 0.
- `inventory` (array of object): Item quantities now; 0 removes. To add an item give its compendium uuid.
  - `item` (string)
  - `uuid` (string)
  - `quantity` (integer, required): Range: at least 0.

## plan-scene-mood

Plan the viewed scene's mood and music: set darkness/light/weather/playlist, save or apply a named preset ("save" with fromCurrent copies the scene as it is), remove-preset, or music (play, stop or switch a playlist). Apply with apply-planned-change, revert with undo-change (music undo is refused once a sequential or shuffle playlist has moved on to its next track by itself: undo soon after, or stop the music with a new plan). Off until the module switch "Scene mood and music" is on.

Kind: read-only. Title: Plan scene mood or music.

Parameters:

- `action` (string, required): One of: `apply`, `set`, `save`, `remove-preset`, `music`.
- `preset` (string): Preset name.
- `fromCurrent` (boolean): save: copy the current look and music.
- `darkness` (number): 0 bright to 1 dark.
- `globalLight` (boolean)
- `weather` (string): Effect id (rain, snow, fog) or "none".
- `playlist` (string): Playlist ("none" stops all music); set, save and music.
- `mode` (string): music: play adds, switch (default) stops the others first. One of: `play`, `stop`, `switch`.

## list-scene-moods

List the scene's mood presets, its look now and the playlists with what plays.

Kind: read-only. Title: List scene moods and playlists.

No parameters.

## check-action

Rules check (on by default). Says whether an attack, spell or item looks legal and why: turn, cost, actions spent, range, slots, uses, concentration, and notes on 2014 vs 2024 differences for a few actions. Read-only.

Kind: read-only. Title: Check an action against the rules.

Parameters:

- `actor` (string, required): Actor name or ID.
- `item` (string, required): Item or spell name or ID.
- `target` (string): Target token name, for range.
- `activity` (string): Activity name or ID (default: first).
- `castLevel` (integer): Level to cast at (default: its own or lowest slot left). Range: 1 to 9.

## get-token-details

Use this for the full properties of one token and linked actor data; for positions of all tokens on a scene use get-token-positions.

Kind: read-only. Title: Get token details.

Parameters:

- `tokenId` (string, required): The ID of the token to get details for

## get-available-conditions

Get a list of all available status effects/conditions that can be applied to tokens in the current game system

Kind: read-only. Title: List conditions.

No parameters.

## get-chat-log

Recent Foundry chat messages from the module's in-memory buffer: dice rolls, ability uses, damage and combat narration. Each has the speaker, type, content and flavor; rolls add formula, total, dice, critical/fumble, advantage/disadvantage and damage total and types. Use this to read the chat and rolls; for a combat recap use get-combat-play-by-play, for game events get-session-log (Prep).

Kind: read-only. Title: Get chat log.

Parameters:

- `limit` (integer): Maximum number of messages to return (default 50, max 200). Default: `50`.
- `speakerName` (string): Filter to messages from this actor/speaker name (partial match).
- `messageType` (string): Filter by message type. One of: `roll`, `damage`, `all`. Default: `all`.
- `sinceTimestamp` (string): ISO timestamp; only return messages created after this time.

## get-combat-play-by-play

Use this for a recap of the current or most recent combat (for raw chat use get-chat-log), rebuilt from the chat-log buffer and the turn timeline: each round by turn (who acted, with roll and damage results), key events (downed, dead, stabilized, conditions applied or removed), and totals for rounds and damage dealt per actor.

Kind: read-only. Title: Get combat play-by-play.

No parameters.

## send-chat-message

Direct write. Post a chat message as a character or as the GM. Types: in-character (ic), out-of-character (ooc), emote, whisper.

Kind: changes something. Title: Send chat message.

Parameters:

- `message` (string, required): The message text to post.
- `speakerActorId` (string): Actor ID to post as. If omitted (and no name given), posts as the GM/world.
- `speakerActorName` (string): Actor name to post as (alternative to speakerActorId).
- `messageType` (string): Type of message. One of: `ic`, `ooc`, `emote`, `whisper`. Default: `ic`.
- `whisperTargets` (array of string): When messageType is "whisper", the user names to whisper to.

## get-character-resources

A character's limited-use resources: spell slots per level, class resources (Sorcery Points, Ki, Rages, Bardic Inspiration, Channel Divinity, Superiority Dice), item charges, concentration and its spell, hit dice, and death saves at 0 HP.

Kind: read-only. Title: Get character resources.

Parameters:

- `identifier` (string, required): Character name or actor ID.

## get-active-effects

Active effects on an actor: name, icon, condition or buff/debuff, remaining duration where tracked, what it modifies and by how much, and whether it needs concentration.

Kind: read-only. Title: Get active effects.

Parameters:

- `identifier` (string, required): Actor name or ID.

## advance-combat-turn

Direct write. Advance combat to the next combatant's turn. Optionally jump directly to a specific combatant with skipTo (their name or actor ID).

Kind: changes something. Title: Advance combat turn.

Parameters:

- `skipTo` (string): Optional combatant name or actor ID to jump to.

## set-initiative

Direct write. Set or override a combatant's initiative value in the active combat. The order changes but the turn does not move: whoever is up stays up until the next turn.

Kind: changes something and can delete or overwrite. Title: Set initiative.

Parameters:

- `combatantName` (string, required): Combatant or actor name.
- `initiative` (number, required): New initiative value.

## roll-initiative-for-npcs

Direct write. Roll initiative for combatants in the active combat and populate the tracker. scope "npcs" (default) rolls for non-player combatants, "all" rolls for everyone, "missing" only rolls for combatants without an initiative value. Pass combatantIds to roll separate initiative for exactly those combatants (overrides scope). Use this for "roll initiative for the monsters" (the enemies, the goblins; Danish "monstrene"): those words mean the NPC combatants, not a name.

Kind: changes something. Title: Roll initiative.

Parameters:

- `scope` (string): Which combatants to roll for (default "npcs"). One of: `npcs`, `all`, `missing`.
- `combatantIds` (array of string): Optional: roll separate initiative for exactly these combatant ids (overrides scope).

## measure-distance

Measure the distance in the scene's grid units (e.g. feet) between two tokens on the active scene, using the scene's grid configuration.

Kind: read-only. Title: Measure distance.

Parameters:

- `fromTokenName` (string, required): Name of the first token.
- `toTokenName` (string, required): Name of the second token.

## get-targets

Return the tokens the GM currently has targeted in Foundry, with each target's AC and HP. Useful before use-npc-activity so an attack can resolve hit/miss against the actual target's AC.

Kind: read-only. Title: Get GM targets.

No parameters.

## get-recent-events

Use this during play to poll "what happened since timestamp X"; for the full session history use get-session-log (Prep). Returns the events plus `latestTimestamp`, which you pass back as `sinceTimestamp` next time to poll incrementally for only new events.

Kind: read-only. Title: Get recent events.

Parameters:

- `sinceTimestamp` (string): ISO timestamp; only return events after this time. Omit for the most recent events.
- `limit` (integer): Maximum number of events to return (default 100). Default: `100`.
- `eventType` (string): Optional event type filter.

## wait-for-game-event

Wait for the next game event instead of polling get-recent-events. Returns when a matching event is logged (a few seconds after it happens), or empty on timeout: call again with sinceTimestamp = the returned latestTimestamp so nothing is missed. gap:true = older events were dropped; read get-recent-events.

Kind: read-only. Title: Wait for a game event.

Parameters:

- `eventTypes` (array of string): Event types, e.g. ["combat-turn"], ["scene-change"], ["roll","damage-roll"]. Empty = any.
- `actorName` (string): Actor name filter (partial match).
- `sinceTimestamp` (string): The latestTimestamp of the previous call (not an event time); matching events after it return at once. Omit = only new ones.
- `timeoutSeconds` (integer): Default 25, max 45.

## roll-saving-throws

Direct write. Roll saving throws (or ability checks / skill checks) for one or more NPC actors using dnd5e system rules, optionally against a DC, reporting each total and pass/fail. Use for "all the goblins roll a DEX save vs DC 15". D&D 5e only.

Kind: changes something. Title: Roll NPC saving throws.

Parameters:

- `targets` (array of string, required): Token names (preferred) or actor names/IDs to roll for.
- `rollType` (string, required): One of: `save`, `check`, `skill`.
- `ability` (string): Ability key for save/check (str/dex/con/int/wis/cha).
- `skill` (string): dnd5e skill key for skill rolls: acr, ani, arc, ath, dec, his, ins, itm, inv, med, nat, prc, prf, per, rel, slt, ste, sur (e.g. "ste" for Stealth, "prc" for Perception).
- `dc` (integer): Optional difficulty class to test against.
- `isPublic` (boolean): Public roll (true) or whispered to the GM only (false or omitted, the default).

## use-npc-activity

Direct write. Trigger an NPC's attack (or other item activity) and report the attack roll total, hit/miss vs an AC, critical, and damage. Use for running the monster side of combat. D&D 5e only.

Kind: changes something. Title: Use NPC attack or activity.

Parameters:

- `actorName` (string, required): NPC actor name or ID. A token on the current scene with this name or ID (or the only token made from this actor) is used first, so an unlinked token spends its own uses.
- `itemName` (string, required): Name of the weapon/feature/spell to use (e.g. "Scimitar").
- `activity` (string): Activity to run (name, id or type); a non-attack one is used (spends its cost) and its damage rolled.
- `targetAC` (integer): Optional target AC to compute hit/miss against.
- `isPublic` (boolean): Public roll (true or omitted, the default) or whispered to the GM only (false).

## manage-rest

Direct write. Run a short or long rest for one or more characters, restoring HP, hit dice, spell slots, and limited-use features per 5e rules, without opening dialogs. D&D 5e only.

Kind: changes something and can delete or overwrite. Title: Run a rest.

Parameters:

- `targets` (array of string, required): Character names or IDs to rest.
- `restType` (string, required): One of: `short`, `long`.
- `newDay` (boolean): Whether this rest starts a new day (resets daily uses). Defaults true for long rests.

## mark-play-session

Direct write. GM ONLY. Mark the start or end of a play session with a line in the bridge vault's session log (sessions/&lt;date>.jsonl). Touches only that log, never game state. Groups session notes and stats. mode "paper" marks a night played on paper; a past date marks it afterwards. Works with Foundry closed.

Kind: changes something. Title: Mark play session start or end.

Parameters:

- `action` (string, required): Mark the table starting or ending a play session. One of: `start`, `end`.
- `mode` (string): "live" (default) or "paper" (played on paper, sheets synced afterwards). One of: `live`, `paper`.
- `date` (string): Paper only: the night as YYYY-MM-DD (today or earlier). Default: now.
- `time` (string): Paper only, with date: local HH:MM (default 12:00 start, 23:59 end).
- `synced` (boolean): Paper only: true = sheets already in Foundry; stops the pre-flight warning.
- `note` (string): Optional note kept with the marker (up to 200 characters).

## get-party

The dnd5e party (group actors, primary party first): each member's HP, AC, passive Perception (with passive Investigation and Insight when the AI Tool: Who would notice switch is on), conditions, exhaustion, hit dice, tokens on the current scene and whether they are in the encounter; the travel pace and whether a slowed member forces slow pace; the current encounter. Read-only. Not for player chat: it shows more than players see.

Kind: read-only. Title: Get party.

No parameters.

## plan-party-change

Plan one party action; nothing changes until apply-planned-change (the GM confirms; needs the "AI Tool: Party (writes)" switch). action "pace": set the travel pace ("pace": slow, normal or fast). "add-to-combat": add the members' tokens on the current scene to the encounter (starts one if none). "rest-request": post dnd5e's short or long rest request card ("rest"); each player clicks it to rest. "place": put members with no token on the GM's viewed scene, on the free squares nearest a spot: the centre of the GM's view (default), a token or map note ("at" token or note, "target" its name) or a square ("at" grid, gridX, gridY); "hidden" for a surprise entrance. Uses the primary party unless groupId names another group. Returns a planId; undo-change reverts it (a rest request card only while nobody has rested from it).

Kind: read-only. Title: Plan party change.

Parameters:

- `action` (string, required): What to plan: pace, add-to-combat, rest-request or place. One of: `pace`, `add-to-combat`, `rest-request`, `place`.
- `groupId` (string): The group actor id; default the primary party (else the only group).
- `pace` (string): For action "pace": the new travel pace. One of: `slow`, `normal`, `fast`.
- `rest` (string): For action "rest-request": short or long (default long). One of: `short`, `long`.
- `at` (string): For action "place": where (default view: the centre of the GM's view). One of: `view`, `token`, `note`, `grid`.
- `target` (string): For "place" at token or note: the token's name or the map note's label.
- `gridX` (integer): For "place" at grid: the column.
- `gridY` (integer): For "place" at grid: the row.
- `hidden` (boolean): For "place": the new tokens start hidden.

## plan-actor-change

Plan damage, healing, temp HP, a condition or a resource change for one or more tokens or actors; apply it with apply-planned-change, revert it with undo-change. dnd5e works out resistances, vulnerabilities, immunities and temp HP; the result previews each target ("Wolf 2: 12 fire damage, 6 taken, HP 11 to 5"). D&D 5e only. It does not level up characters: a level-up happens on the character sheet in Foundry, so say that.

Kind: read-only. Title: Plan damage, healing or conditions.

Parameters:

- `action` (string, required): damage, healing, temp-hp, condition (on or off), resource (set a value) or clear-conditions. One of: `damage`, `healing`, `temp-hp`, `condition`, `resource`, `clear-conditions`.
- `targets` (array of string, required): Token names on the current scene (preferred: unlinked NPC tokens have their own HP) or actor names.
- `amount` (integer): damage, healing, temp-hp: the amount.
- `damageType` (string): damage: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing or thunder. Omit for untyped.
- `multiplier` (number): damage: 2 for a critical, 0.5 for half.
- `ignoreResistance` (boolean): damage: ignore the target's resistances and immunities.
- `condition` (string): condition: the id or name (prone, poisoned, exhaustion...).
- `active` (boolean): condition: false removes it. Default: `true`.
- `level` (integer): condition exhaustion: the level to set.
- `rounds` (integer): condition: lasts this many rounds, then counts as expired (clear-conditions removes it). Omit for until removed. Not for exhaustion. Range: 1 to 100.
- `conditions` (array of string): clear-conditions: names to remove (prone...); omit for expired effects only.
- `resource` (string): resource: "spell3", "pact", a class resource (Ki Points, primary) or an item name.
- `value` (integer): resource: the new current value (0 to max).

## plan-token-change

Plan moving, changing or deleting tokens on the current scene; apply it with apply-planned-change, revert it with undo-change. "move": one token to gridX/gridY (a square) or x/y (pixels), or any tokens by dx/dy squares. "update": set the listed fields (vision and light too). "delete": removes the tokens and their place in the encounter (destructive; undo restores both). "fit-scale": size tokens to the scene's scale (a medium creature covers 5 ft, so a town or overland map with squares of 16 to 200 ft gets smaller tokens and a 2.5 ft scene larger ones); all creatures on the scene (tokens with no creature size are skipped) or only the named ones; a 5 ft scene changes nothing.

Kind: read-only. Title: Plan token change.

Parameters:

- `action` (string, required): move, update, delete or fit-scale. One of: `move`, `update`, `delete`, `fit-scale`.
- `tokens` (array of string): Token names or ids on the current scene. Required except for fit-scale (omit it there for every creature).
- `gridX` (integer): move: grid column.
- `gridY` (integer): move: grid row.
- `x` (number): move: pixels from the left.
- `y` (number): move: pixels from the top.
- `dx` (integer): move: squares right (negative: left).
- `dy` (integer): move: squares down (negative: up).
- `name` (string): update: the token name.
- `hidden` (boolean): update: hidden from players.
- `disposition` (integer): update: -2 secret, -1 hostile, 0 neutral, 1 friendly. One of: `-2`, `-1`, `0`, `1`.
- `elevation` (number): update: elevation in scene units (ft).
- `rotation` (number): update: rotation in degrees.
- `lockRotation` (boolean): update: lock the rotation.
- `width` (number): update: width in grid squares.
- `height` (number): update: height in grid squares.
- `sightEnabled` (boolean): update: the token has vision.
- `sightRange` (number): update: vision range (ft).
- `visionMode` (string): update: basic, darkvision...
- `lightDim` (number): update: dim light radius (ft); a torch is 40.
- `lightBright` (number): update: bright light radius (ft); a torch is 20.
- `lightColor` (string): update: light color, "#ff9329".
- `lightAnimation` (string): update: torch, pulse, flame...

## plan-scene-change

Plan scene dressing on the current scene: an area-of-effect template ("template"), clearing templates ("clear-templates"), darkness and global light ("mood"), a map pin ("note", "remove-note") or loot for a character ("loot"). Apply it with apply-planned-change, revert it with undo-change; the GM sees every change in Recent Changes. A template result lists tokensInside; a loot result lists skippedItems that were left out (bad UUID, not an Item, or no target character).

Kind: read-only. Title: Plan scene dressing.

Parameters:

- `action` (string, required): template, clear-templates, mood (darkness and global light), note, remove-note or loot. One of: `template`, `clear-templates`, `mood`, `note`, `remove-note`, `loot`.
- `shape` (string): template: the shape (required). One of: `circle`, `cone`, `ray`, `rect`.
- `distance` (number): template: size in grid distance units (radius for circle, length for cone/ray/rect; required).
- `x` (number): template: origin X in pixels (or originTokenName). note: X in pixels (or tokenName).
- `y` (number): template: origin Y in pixels (or originTokenName). note: Y in pixels (or tokenName).
- `originTokenName` (string): template: center it on this token instead of x/y.
- `direction` (number): template: facing in degrees (cone/ray/rect).
- `angle` (number): template cone: angle in degrees (default ~53).
- `width` (number): template ray: width in grid units (default 5).
- `fillColor` (string): template: hex color, e.g. "#ff0000".
- `templateId` (string): clear-templates: the template to remove.
- `all` (boolean): clear-templates: remove all of this tool's own templates (never a hand-made GM region on Foundry 14).
- `darkness` (number): mood: darkness level 0 (bright) to 1 (dark).
- `globalLight` (boolean): mood: enable or disable global illumination.
- `text` (string): note: the label. remove-note: remove the pins whose label is exactly this text.
- `tokenName` (string): note: place the pin at this token instead of x/y.
- `journalName` (string): note: link the pin to an existing journal entry by name.
- `entryId` (string): note: link to a journal entry by id (alternative).
- `icon` (string): note: icon path (default icons/svg/book.svg).
- `iconSize` (integer): note: icon size in px (default 40).
- `noteId` (string): remove-note: the pin to remove.
- `targetCharacter` (string): loot: the character to receive it. Omit to only announce in chat.
- `currency` (object): loot: coins to add, e.g. { "gp": 50, "sp": 25 }.
  - `pp` (integer): Range: at least 0.
  - `gp` (integer): Range: at least 0.
  - `ep` (integer): Range: at least 0.
  - `sp` (integer): Range: at least 0.
  - `cp` (integer): Range: at least 0.
- `itemUuids` (array of string): loot: compendium item UUIDs to add (from search-compendium).
- `announce` (boolean): loot: post a loot summary to chat (default true).

## play-playlist

Direct write. Play (default) or stop a playlist by name. Nothing to undo. Use to change the music as the story moves.

Kind: changes something. Title: Play or stop playlist.

Parameters:

- `playlistName` (string, required): Playlist to control by name.
- `action` (string): Play (default) or stop the playlist. One of: `play`, `stop`.

## plan-combat-change

Plan starting or ending a fight. "start" puts tokens of the viewed scene in a new combat (default: player characters and Hostile tokens; already at round 1, no initiative rolled, so roll it next). "end" removes the active combat. Apply with apply-planned-change, revert with undo-change; ending is destructive, so the GM confirms. Shows in Recent Changes. Undo of an end does not restore effects that end with combat or token movement history (the result carries a warning).

Kind: read-only. Title: Plan ending a fight.

Parameters:

- `action` (string, required): start: new combat. end: close the active combat. One of: `start`, `end`.
- `tokenIds` (array of string): start: the tokens to fight. Omit for player characters and Hostiles.
- `sceneId` (string): start: scene (default: the viewed one).
- `combatId` (string): end: the combat to close. Omit for the active one.
