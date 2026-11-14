### Orange Pi

- **Stage checks wait for a joining GM browser:** the "players are online" check re-reads Foundry's user count for about 10 seconds (longer when Docker does not answer) when the only excess could be a GM browser that is running but has not logged "joined world" yet. A real player beyond the GM browsers still refuses on the first reading (Backlog `grave-check-wrong-pack`).
