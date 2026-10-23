### Dashboard

- **Recent Changes, Everyone tab, updates by itself:** a token moved in Foundry shows within a few seconds, without the refresh button.
- **Roll requests from the Tool Runner:** the roll tools no longer ask for `userConfirmedVisibility`; the Public tick on the form is the pick. Claude still has to ask first.

### Module

- **Ability checks show pass or fail:** a roll made from a `request-ability-check` card with a DC carries the DC, so the Live Feed says "vs DC 15: failure". On a public request the player page gets it too (the card already showed the DC to everyone); a private one stays GM-only.
- **Live Feed damage line:** a hit that takes a character to 0 HP reads "took 9 damage (HP 9 to 0)". dnd5e 6 adds Unconscious or Dead at 0 HP only in combat and only when its "Auto-apply downed" world setting asks for it (default off); our damage path goes through a normal HP update, so that setting applies to it too.
