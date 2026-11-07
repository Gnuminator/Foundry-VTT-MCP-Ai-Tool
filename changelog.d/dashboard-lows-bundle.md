### Dashboard

- **Health line:** a stream that goes silent for 45 seconds is closed and opened again by the page itself (a half-open stream after a sleep or a tunnel stall recovers without a reload). "Last update" ages from the server's clock, so a wrong clock on the viewing device no longer turns it amber. A screen reader hears which part turned red. The Recorder and Play log details open on a tap, not only on hover, and their times show on the viewer's clock. A pump error on the Play log dot says "errors", not "gaps".
- **Smaller stylesheets:** a few rules the old page used and nothing renders now are gone from `styles.css` and `moments.css`.

### Discord bot

- **Recorder dot:** a stream error is dropped when that speaker mutes. A `FOUNDRY_AI_BOT_STATUS_PORT` that is not a port, or a port already in use, is now said plainly in the bot log.
