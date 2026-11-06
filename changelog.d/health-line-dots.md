### Dashboard

- **Recorder and Play log dots on the health line:** the GM health line now shows a Recorder dot
  (a speaker with no audio for 5 minutes, a failed audio stream, the bot unable to get back into the
  voice channel) and a Play log dot (the session or play log not recording since a time, or a recent
  gap with records lost), each only while something is wrong, with the plain words on hover. A bot
  or bridge that does not answer shows "unknown" in grey, never OK. The Recorder dot needs the bot's
  new read-only status endpoint (`FOUNDRY_AI_BOT_STATUS_PORT` in the bot settings) and
  `DASHBOARD_BOT_STATUS_URL` in the dashboard; see `docs/dev/PI-SETUP.md`. `get-preflight` gained a
  quick `action: "pumps"`.
