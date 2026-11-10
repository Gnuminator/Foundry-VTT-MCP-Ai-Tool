### Fixes

- **Player book search after a restart:** the first `search-books` after Foundry or the module restarts no longer times out. The module builds the player book indexes in the background at start (bridge user's browser), and the player read query now waits up to 50 s instead of 10 s for a cold build (player-search-cold-index).
- **Player tool messages and text:** a timeout reads "Foundry did not answer in time. Try again." instead of the bridge's query name. `&Reference[condition=prone]` reads "prone" and `&Reference[Spell Scroll]` reads "Spell Scroll", and a bare `@UUID[...]` reads "(link)" instead of vanishing, in book entries, on the character sheet, in GM rules search snippets and in creature biographies (one shared function; player-set-lows-4).
