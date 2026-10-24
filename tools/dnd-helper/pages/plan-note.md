# Character plan note

For things that are not sheet data ("at level 4 I take Sentinel", "multiclass into Cleric at 6"),
keep one plan note per character in the player's own notes (Obsidian, or any notes app). Foundry is
the source of truth for the sheet; the plan note is only intent. Never copy sheet data or book text
into it: it goes stale, and book text must stay out of notes.

Suggest this format (a Markdown file, for example `Characters/<name> plan.md` in the player's own
vault; the Foundry AI Tool mirror writes a separate sheet note and never touches a plan note):

```markdown
---
type: character-plan
character: <name>
class: <class> (<subclass if chosen>)
updated: <date>
---

# <name> plan

## Concept

One or two lines: who they are and what they are good at.

## Build card (level 1)

Ability scores, species, background, class, skill and spell picks, as agreed.

## Level path

| Level | Plan          | Why | Status  |
| ----- | ------------- | --- | ------- |
| 2     | ...           | ... | planned |
| 3     | subclass: ... | ... | planned |

## Open questions

- Things to ask the GM or check in the book.

## Log

- <date>: what changed and why (new level taken, plan changed).
```

When you write one for the player, put it in the chat for them to save (you have no file tool in
this chat). Update the Status column and the Log when a level is taken.
