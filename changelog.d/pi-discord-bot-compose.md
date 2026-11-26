### Orange Pi

- **The Discord recorder bot can run as a container:** the bot is now a fifth compose service behind the `discord-bot`
  profile. Stage 24 `MODE=bot` moves it from its systemd unit into the stack (snapshot, no recording running, rolls back to
  the unit by itself if it does not log in), `MODE=bot-restart` recreates it after a token change, `MODE=bot-back` puts only the
  bot back on its unit, and `MODE=rollback` brings the whole stack back to units. CI checks the image on ARM64 without a token: the voice libraries load, UDP works and a test
  recording converts into the recordings folder. Nothing changes on the Pi until the switch is run.
