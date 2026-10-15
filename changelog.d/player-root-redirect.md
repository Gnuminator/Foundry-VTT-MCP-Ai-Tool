### Fixes

- **A player who opens the dashboard address lands on the player view:** with the player/GM split
  on, a player (a player token, or a Cloudflare Access email outside `GM_EMAILS`) who opened the
  dashboard root or `/next/` got the GM page with nothing in it. Both pages now ask the server for
  the role and send a player to `/player`, taking their player token along. A visitor turned away
  without a token who has a player token saved goes there too. The GM page is unchanged for the GM.
