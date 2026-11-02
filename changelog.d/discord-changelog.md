### Discord

- **#changelog and #pr-log:** two read-only channels on the game server. Every merge through the
  gate posts one line ("#number title" with a link) to #pr-log, silently (Discord's no-notification
  flag); a release gets short Danish lines in #changelog from the release steps, and a Pi stage 5 build
  of a new release tag posts "Serveren kører nu vX.Y.Z." (normal posts, rare). No post mentions anyone,
  and a post that fails only prints a warning (it never fails a merge or a deploy). Settings: `DISCORD_CHANGELOG_CHANNEL_ID` and
  `DISCORD_PRLOG_CHANNEL_ID` in `discord-bot.env`; the sender is
  `packages/discord-bot/announce/announce.mjs`.
