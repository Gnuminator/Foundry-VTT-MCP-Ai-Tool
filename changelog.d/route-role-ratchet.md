### Tests

- **One test says who may call each dashboard route:** `route-role-ratchet.test.ts` lists every route the built dashboard registers and asks it with the player token and with no token. A route that answers anything but 401 or 403 must be on a short named public or player list, so a new endpoint is GM only unless someone writes it onto a list on purpose (backlog `route-role-ratchet`).
