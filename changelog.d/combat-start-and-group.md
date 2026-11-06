### Fixes

- **Starting a fight no longer logs an error on open clients:** a fight started with plan-combat-change start (created already begun, round 1) made Foundry's `Combat#_onCreate` throw "Cannot read properties of undefined (reading 'round')" on every open client. The module now gives such a fight the state of one that has not begun, so the start of round and turn events fire as they do for a fight started in Foundry.
- **A direct write right after an AI change is its own change:** Next turn, initiative, rests, chat and the other direct writes now end the change group first, so within 3 seconds after an applied AI change they show as their own entry in Recent Changes (and can be undone on their own) instead of hiding under the AI change.
