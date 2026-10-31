### Orange Pi

- **Stage 11 run log:** stage 11 now logs every line it prints (not the output of the tools it runs), with a time, to `/var/lib/foundry-import/world-run-<time>.log` (root only), like stages 14 and 19. It already ignores a dropped SSH connection while Foundry is stopped (`trap '' HUP PIPE`); now the Pi keeps the story of such a run. The closing summary goes into the log too.
- **Docs:** `docs/dev/PI-SETUP.md` "World switches" and the stage 11 header describe the owed-switches marker, how `WORLD_SWITCHES=0` clears it, the refusal of `WORLD_SWITCHES=1` with a Plan B push-back, and the log. The push-back refusal test now also checks that it comes before Foundry stops.
