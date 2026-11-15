### Pi

- **Crash-loop guard and clock check (stage 32):** the bridge, the dashboard, Foundry and the Assistant GM browser now stop after a burst of failed starts and say so in #gm-bot (OnFailure drop-ins; nothing is restarted by the stage), Foundry restarts after a clean exit too, and a 15 minute timer posts when the Pi's clock stops being synchronized with NTP. Not run on the Pi yet; it needs a snapshot and the user's OK.
