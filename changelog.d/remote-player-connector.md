### Players

- **Remote player connector:** a player can add the table as a Claude custom connector by its web
  address and sign in with their own email (Cloudflare Access Managed OAuth), with no file, Client ID
  or secret. `/mcp/player` accepts the app token of the new "Player remote" Access application next
  to service tokens, maps the verified email to one non-GM Foundry user from the player config file
  (`appAudience`, `emailPlayers`, `remoteEndpoint`), serves the same five read-only tools and refuses
  a GM or unlisted email with a bare 403. My character shows the address; the extension download
  stays as the fallback.
