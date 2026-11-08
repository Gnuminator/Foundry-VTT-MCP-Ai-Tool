---
title: The D&D helper for players
description: Install Claude Desktop, add the Foundry player connector and the D&D helper skill, then build, level up and check your own character and look up rules, step by step.
---

# The D&D helper for players

This guide gets you from nothing to a working D&D helper: a Claude chat on your own computer that
can read **your** character in Foundry and look things up in the books our table uses. It is
written for someone who has never opened Claude Desktop, so go slowly and do the parts in order.
Set aside about thirty minutes the first time.

The helper is **optional**. Everything it does you can also do by hand in Foundry, and the game
works the same without it.

## What it is, in one minute

Claude is an AI assistant from Anthropic. Claude Desktop is the app you chat with it in. Out of the
box Claude knows nothing about our game. Three small pieces change that:

- **The extension** (a file called `foundry-player.mcpb`) is a plug that lets Claude Desktop ask
  our Foundry for a few things. It is called the **player connector**.
- **Your two values** (a Client ID and a Client Secret) are your personal key to that plug. They
  tell the server who you are, so you see your own character and nobody else's.
- **The skill** (a file called `foundry-dnd-helper-player.zip`) is a set of instructions that
  teaches Claude how to help with D&D at our table: how to plan a character, how to walk you
  through a level-up, how to check your sheet, how to answer a rules question.

What it **does**: reads your own characters, reads the books our table allows players to read,
and talks you through the choices.

What it **never does**: change anything. It cannot edit your sheet, roll dice, move a token or
send a message in the game. You make every change yourself by clicking in Foundry, and Claude
tells you what to click. That is on purpose.

## Before you start

You need:

- A Windows computer (the same one you play Foundry on is fine).
- An email address for your **own** Claude account. Do not borrow anyone else's: your chats are
  yours, and the table does not pay for your use.
- Your **Client ID** and **Client Secret**, two long strings of letters and numbers. The person
  who runs the tool sends them to you privately, and you can also see them on your own **My
  character** page under **Your Claude connector** (there are copy buttons next to each).
  Treat the secret like a password: do not post it in Discord, do not put it in a screenshot.
- The file `foundry-player.mcpb` and the file `foundry-dnd-helper-player.zip`. The person who runs
  the tool tells you where to download them.

## Step 1: install Claude Desktop and sign in

1. Go to <https://claude.com/download> and download Claude for Windows.
2. Run the installer and open the app.
3. Sign in with your own account. If you do not have one, create one with your email address. A
   free account may be enough to try the helper. If a step below mentions a menu you do not have
   (Customize or Skills, say), your plan may not include it: tell the person who runs the tool
   which one.
4. Open a chat and send "hello" to check that it answers. If it does, the app works.

Anthropic changes the menus now and then. If a button is not where this guide says, look for the
same word nearby, or use the search box in Settings.

## Step 2: add the extension and paste your two values

1. Find `foundry-player.mcpb` in your Downloads folder and **double-click** it. Claude Desktop
   opens and shows an install window for it. (If nothing happens, open Claude Desktop, go to
   **Settings**, then **Extensions**, and drag the file into that window.)
2. Click **Install**. Claude may warn that extensions run on your computer. This one only talks
   to our game server, and the file itself holds no book text and no secret.
3. A form asks for two things. Paste your **Client ID** into the first box and your **Client
   Secret** into the second. The secret box hides what you type.
4. Make sure the extension is switched **on** (a toggle next to its name in Settings,
   Extensions).
5. Quit Claude Desktop completely (right-click its icon by the clock and choose Quit, closing the
   window is not enough) and open it again.

To check it works, open a new chat and click the **+** or the tools icon near the message box.
You should see **Foundry** (or **foundry-player**) listed with five tools. If you do, the plug is
in.

## Step 3: add the skill

1. In Claude Desktop open **Customize**, then **Skills**.
2. Choose to add a skill and pick `foundry-dnd-helper-player.zip`. **Do not unzip it first.**
3. Make sure the skill is switched on.

## Step 4: your first question

Start a new chat and ask:

> What characters do I have in Foundry? Give me a short summary of each.

Claude will ask permission to use a tool the first time. Click **Allow** (or **Always allow** for
this tool, as you prefer). You should get a short summary of your own character or characters.

If you get that, you are done with setup. Everything below is what to ask for.

## What to ask: the four flows

Claude is not a form. Ask in your own words, in your own language. The examples are only
starting points.

### 1. Make a new character

Good for when you have a concept, or no idea at all.

> I want to make a new character. I like the idea of a sneaky problem solver who is good with
> people. What are my options?

What happens: Claude asks you two or three short questions (how you want to play, how ability
scores are chosen at our table, new to D&D or not), looks up classes, species and backgrounds in
the books, offers two or three combinations, and then writes you a **build card**: a short list
that follows the tabs of Foundry's character builder, **Actor Studio**, in order. Our table starts
at **level 3**, so the card has a level 1 part and then the two level-ups, with the subclass at
level 3.

You click through Actor Studio with the card (the guide [Make your
character](make-a-character.md) shows every tab with pictures). Then say "I'm done" and Claude
reads your sheet and checks it against the card (that is flow 4 below).

More asks:

- "Give me three different character ideas for a table that likes roleplay."
- "I picked Rogue. Which backgrounds fit, and what do they give me?"
- "Make me a build card for a level 3 Cleric."

### 2. Level up

> I just got enough XP for the next level. What do I get, and what do I have to choose?

Claude reads your sheet and what the next level grants, looks each feature up in the books, and
answers in two parts: what you get automatically, and what you choose, with two or three options
for **your** build and a recommendation. For hit points it tells you the average and the roll
result for your hit die, and the average is the safe pick. Then it tells you what to click in
Foundry's level-up window.

Two traps it knows about, so listen when it mentions them: at level 3 you must click **Complete**
in the second window that lists your subclass features, or the subclass is silently not added; and
a spellcaster's level-up does not ask which spells you learn, you add them on the Spells tab.

More asks:

- "Which feat should I take at level 4? I mostly fight from the back line."
- "Can I swap a spell when I level up?"
- "I'm thinking of taking a level of Fighter instead of my next Wizard level. What does that
  cost me?" (it will also say to confirm multiclassing with your GM)

When you have decided things for later levels, say "Write that down as a plan for my character"
and Claude writes a plan note you can paste somewhere safe, so the next chat can pick it up.

### 3. Ask a rules question

> How does grappling work? What is the difference between Dodge and Disengage?

Claude searches the books, reads the entry and answers in this shape: the answer first, a few
bullets on how it works, then **Source** (book, entry name and rules version). It paraphrases and
does not paste pages. If the books do not cover it, it says so, and labels anything extra "not
from the books".

If the rules do not settle a question, it gives you two ways to rule it and a recommendation. The
GM has the final word at the table.

### 4. Check my sheet

> Check my character sheet. Does anything look wrong?

Claude reads your sheet and goes through it: level, class and subclass, ability scores, hit
points, saving throws, skills, spells, equipment, name. It reports each line as OK or as "Wrong:
... click here to fix it". Use it right after building a character and after every level-up. A
skipped choice in a Foundry window is easy to miss and easy to catch this way.

### "Which is best?"

The books list options, they do not rank them. If you ask "what is the strongest Fighter
subclass", Claude gives its own reasoning for your build and says plainly that it is **opinion**.
It may also point you to the Dungeon Mister 2024 guides,
<https://dungeonmister.com/dnd-5e-2024/>, as one opinionated community source. That is one
writer's view, not the rules, and not the table's. Claude only links it (and may open it if web
search is on in your chat); it does not copy the site.

## What the helper cannot see

This is by design, and it also protects the story.

- **Only your characters.** Not other players' characters, not monsters, not the GM's notes.
- **Only the books the table allows players.** Not the adventure, not the GM's books. If you ask
  about the story, a location, an NPC or what the GM has planned, it will say it cannot see that.
  Ask the GM.
- **Short passages.** A search returns a few short excerpts, and one entry is capped in length. For
  a long rule, Claude tells you where to read the whole thing in Foundry.
- **No changes.** It cannot edit anything. It cannot roll for you either.
- **Not live.** It reads your sheet when it asks. If you change something in Foundry, say so and
  ask it to look again.

Sometimes a result carries a note such as "2 results hidden". That is normal. Some text is held
back on purpose. Do not try to get around it, just ask the GM.

Also remember that your chats with Claude go to Anthropic under your own account, like any chat.
Nothing you say to the helper is sent to the other players.

## Troubleshooting

**Claude does not mention Foundry at all, or says it has no tool for that.**
Open Settings, Extensions and check the Foundry extension is switched on. Then quit Claude Desktop
completely and reopen it. Start a **new** chat: an old chat does not pick up new tools.

**It says "not found" about my character.**
Check how the name is spelled on your sheet and ask again with the exact name. If you have no
character yet, that is correct: make one first. If the name is right, your values may be wrong
(see the next item) or the character may not be assigned to you in Foundry. Ask your GM to check
that you own it.

**An error, "unauthorized", "forbidden" or "could not connect".**
Almost always the two values. Open Settings, Extensions, the Foundry extension, and check that the
Client ID and Client Secret were pasted whole, with no space at the start or end and nothing
missing. Paste them again from your **My character** page with the copy buttons. If they are right,
the game server may be down. Ask the person who runs the tool.

**It answers from memory and does not name a book.**
Ask: "Look that up in the books first and name the entry." If the lookup fails, it should say so
and label the rest as general knowledge. If it never says so, tell the person who runs the tool.

**It says it cannot find something I know is in the book.**
The table may not allow that book for players, or the entry's name may differ. Try a different
word ("grapple" and "grappled"), or ask for a search by what the thing does.

**The skill is not used.**
Open Customize, Skills and check "foundry-dnd-helper-player" is on. Start your message with "Use
the D&D helper skill to..." the first time.

**It claims it changed my character.**
It cannot, and it should never say so. Check your sheet in Foundry, then tell the person who runs
the tool. The helper only reads.

**Claude Desktop will not open the `.mcpb` file.**
Update Claude Desktop (a recent version is needed), then drag the file into Settings, Extensions.

**I want to start over.**
Remove the extension in Settings, Extensions, and install it again from the file. Your values are
asked for again.

## Getting new values

You need new values when you lose them, when you think someone saw your secret, or when the
person who runs the tool tells you they were reset.

1. Open your **My character** page (the private link you were sent) and look at **Your Claude
   connector**. If the card shows a new pair, use the copy buttons.
2. If it does not, message the person who runs the tool and ask for new values. Say which
   character is yours. They send them privately.
3. In Claude Desktop open Settings, Extensions, the Foundry extension and replace the Client ID
   and the Client Secret. Quit and reopen Claude Desktop.
4. Ask whether your old values still work. If you lost the secret, that does not matter. If
   someone else saw it, ask for the old values to be switched off too.

Never send your secret in a public channel. If you did, ask for new values.

## Quick reference

| I want to...                 | Ask...                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| See what the helper can read | "What characters do I have in Foundry?"                     |
| Plan a new character         | "I want to make a new character."                           |
| Level up                     | "What do I get at my next level and what do I choose?"      |
| Check my sheet               | "Check my character sheet."                                 |
| Look up a rule               | "How does X work?"                                          |
| Get an opinion               | "Which X is best for my build?" (it will say it is opinion) |
| Start over                   | New chat, same question                                     |

If something here is wrong or out of date, tell the person who runs the tool, so the guide gets
fixed for everyone.
