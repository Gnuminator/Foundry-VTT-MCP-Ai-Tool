### Fixes

- **No console error when ownership is removed or undone:** taking a player's ownership level
  off an actor or page (undoing "give Player OBSERVER", hiding a handout from chosen players) no
  longer logs "ownership: is not a mapping of user IDs and document permission levels" in
  Foundry 14. The module now always replaces the whole ownership map instead of first sending a
  per-key deletion that Foundry 14 rejects; the result is the same as before.
