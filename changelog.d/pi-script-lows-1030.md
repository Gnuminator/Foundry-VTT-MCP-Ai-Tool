### Orange Pi

- **Stage 11, owed world switches:** a `world-<id>.switches-pending` marker left by a failed run is now cleared when the world is replaced by a push-back or a run with `WORLD_SWITCHES=0`, and when `WORLD_SWITCHES=0` runs on the kept world, so a later plain run no longer sets switches the GM gave up on. `WORLD_SWITCHES=1` together with a Plan B push-back is refused up front, the failure message no longer says `0` "leaves" the switches, and the stage ignores a dropped SSH connection (`trap '' HUP PIPE`) like stages 14 and 19.
- **Tests:** stage 19 has a test for a failed read of the picture now in the world (nothing written, nothing stopped), and its runuser pattern is looser.

### Session notes

- **Consent file:** `consent set` refuses to rewrite a file whose `players` has an entry that is not an object (it would have been dropped, and it may be a "no"), and keeps other top-level keys when it rewrites.
