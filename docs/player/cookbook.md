---
title: D&D helper cookbook
description: Ready-made requests for the D&D helper, grouped by the moment you need them (planning a character, levelling up, checking your sheet, rules questions), with what the helper does and one tip each.
---

# D&D helper cookbook

Ready-made requests for the [D&D helper](dnd-helper.md), the Claude chat that can read your own
character in Foundry and look things up in the books our table uses. Copy the words in quotes and
change the details to yours. The helper is optional: everything here can also be done by hand in
Foundry.

**The helper only reads.** It never changes your sheet, rolls dice or moves a token. It tells you what
to click, and you click in Foundry. The how-tos for the player page are in
[Using the player page](player-page.md).

## Four habits that make every request better

1. **Say who you are at the table.** "New to D&D", "I have played 5e for years", "my first caster".
   It changes how much the helper explains.
2. **Name the exact thing.** The character's name as it is on the sheet, the exact spell or feat.
3. **Say what you want back.** "Three options and a pick", "a list of what to click", "two lines".
4. **Ask it to name the entry.** "Say which book and entry that is from." If it cannot find one, it
   says so and labels the rest as not from the books.

## Before session 0: planning a character

### Plan a character from a vibe

- **Type:** "I want to play a sneaky problem solver who is good with people. Ask me two or three
  questions, then give me three options."
- **What happens:** the helper asks how you want to play, looks up classes, species and backgrounds
  in the table's books, and offers two or three combinations with a recommendation.
- **Tip:** say if you are new to D&D. Then it explains the words as it goes.

### Get a build card to click through

- **Type:** "Make me a build card for a level 3 Cleric, using the species and background we talked
  about."
- **What happens:** it writes a short list that follows the tabs of Foundry's character builder,
  Actor Studio, in order: the level 1 part, then the two level-ups, with the subclass at level 3.
- **Tip:** keep the card open next to [Make your character](make-a-character.md), which shows every
  tab with pictures.

### Compare two options

- **Type:** "I am torn between Rogue and Ranger for a scout. What do I get from each at levels 1
  to 3, and what would I miss?"
- **What happens:** it reads the class entries and puts the two side by side, then says which fits
  what you told it you want.
- **Tip:** "which is best" is opinion, and the helper says so. The books list options, they do not
  rank them.

## Levelling up

### Level up

- **Type:** "I have enough XP for the next level. What do I get automatically, what do I choose,
  and what do I click in Foundry?"
- **What happens:** it reads your sheet and the next level, then answers in two parts: what you get,
  and what you choose with a pick for your build. It ends with the clicks.
- **Tip:** at level 3 click **Complete** in the second window, or the subclass is not added. The
  helper reminds you.

### Pick a feat

- **Type:** "Which feat should I take at level 4? I mostly fight from the back line."
- **What happens:** it lists a few feats you qualify for, what each does, and a recommendation for
  your build, with the book entry named.
- **Tip:** tell it what your fights usually look like. A feat that is great in one party may not be
  in yours.

### Swap a spell and plan ahead

- **Type:** "Can I swap a spell when I level up? And write down a plan for my next three levels."
- **What happens:** it explains the swap rule for your class and writes a plan note you can paste
  somewhere safe. A spellcaster's level-up does not ask which spells you learn, so the helper tells
  you to add them on the Spells tab.
- **Tip:** paste the plan at the start of your next chat, so the helper picks up where you left
  off. It does not remember old chats.

## Checking your sheet

### Check the sheet

- **Type:** "Check my character sheet against the build card we made. Does anything look wrong?"
- **What happens:** it reads the sheet and goes line by line: OK, or "Wrong: click here to fix it".
- **Tip:** do this after every level-up. A skipped choice in a Foundry window is easy to miss.

### See what you can do on your turn

- **Type:** "List what I can do in combat with my character: attacks, spells, bonus actions and
  anything with limited uses."
- **What happens:** it reads your items and features and sorts them into action, bonus action and
  reaction.
- **Tip:** it reads the sheet when it asks, not live. After a rest or a fight, say so and ask it to
  look again.

### Understand a number on the sheet

- **Type:** "Why is my AC 16? And what is my spell save DC made of?"
- **What happens:** it reads the sheet and shows the sum piece by piece: armor, Dexterity,
  proficiency and so on.
- **Tip:** a number that looks off may be a skipped choice. Follow up with "Check my character
  sheet".

## Rules questions at or between sessions

### Look up a rule

- **Type:** "How does grappling work? Say which book and entry it is from."
- **What happens:** it searches the books and answers in this shape: the answer first, a few
  bullets on how it works, then the source. It paraphrases and does not paste pages.
- **Tip:** if it cannot find it, try a different word ("grapple" and "grappled"), or ask for a
  search by what the thing does.

### Compare two actions

- **Type:** "What is the difference between Dodge and Disengage, and when is each worth it?"
- **What happens:** it reads both entries and gives the difference plainly, then a short rule of
  thumb.
- **Tip:** the rule of thumb is advice, not a rule. The GM has the final word at the table.

### Check a tricky spot before the session

- **Type:** "If I cast Hold Person on a creature and it then moves out of my line of sight, does the
  spell or my concentration end?"
- **What happens:** if the books settle it, you get the answer and the entry. If they do not, you
  get two ways to rule it and a recommendation.
- **Tip:** bring the question to the GM before the session if the books do not settle it. "I would
  rule it like this, is that OK?" is an easy thing to ask.

### The story? Ask the GM

The helper cannot see the adventure, monsters, other players' characters or the GM's notes. For the
story, a location, an NPC or what is planned, ask the GM. More in
[what the helper cannot see](dnd-helper.md#what-the-helper-cannot-see).
