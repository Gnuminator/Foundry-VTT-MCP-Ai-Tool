### Orange Pi

- **Stage checks wait for the online count to settle:** the "players are online" check re-reads Foundry's user count and the joined GM browsers for up to 10 seconds before refusing, so a GM browser joining or leaving no longer causes a false refusal (Backlog `grave-check-wrong-pack`).
