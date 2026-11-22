### Discord bot

- **A stuck voice reconnect is cut after 30 seconds:** if the recorder's connection is not Ready 30 seconds after a disconnect (hung in Signalling or Connecting), it is destroyed so the normal rejoin path and its alerts run (backlog `recorder-reconnect-watchdog`).
- **A DM when a recording was never pulled:** the bot's 15 minute owner check sends one DM for a converted session with no `.pulled` marker after 24 hours, and a reminder every 24 hours until it is pulled (backlog `recorder-unpulled-notice`).
