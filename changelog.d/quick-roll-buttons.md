### Dashboard

- **Ask for a roll in one click:** the Party card has an "Ask for a roll" bar (check, save or skill, DC, private or public, advantage) with "Ask the whole party" and an "Ask roll" button on each member. The combat strip has the same bar with "Ask the party" and "Ask <picked player character>". The requests go through request-player-rolls, so they show on the player page and land in the play log. The last pick is remembered.
- **Simpler Damage / Heal:** the strip's Damage / Heal opens a small form with one amount field, a Damage or Heal toggle and damage type chips. One button, named for what it does ("Deal 8 fire damage to Goblin Archer and Ogre Brute in Foundry"), plans and applies in the same click, with Undo on the toast. Condition still opens the Tool runner.

### Tools

- **request-player-rolls takes a DC:** an optional `dc` the card shows and the roll is judged against, as request-ability-check already did for checks.
