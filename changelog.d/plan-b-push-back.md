### Orange Pi (D-097)

- **Plan B push-back, the world goes back to the Pi after the night:** `scripts/plan-b/push-back.ps1`
  builds the bundle from a played Plan B copy (it refuses while Plan B runs and when the copy was
  never played) with `push-world.ps1 -PushBack`: the world keeps the Pi's own Gamemaster password
  (`world-refs.mjs --gm-password-ok`), and `MANIFEST.txt` records the Pi backup Plan B started from.
  Stage 11 takes such a bundle only with `REPLACE_WORLD=1 KIT_WORLD=` and the Pi's world env file,
  and refuses when the Pi's world has a document created or changed after that backup (it lists
  up to five, names only) unless `REPLACE_NEWER=1`. The Pi's old copy goes to `prev-<time>` either
  way. A rerun after a late failure passes the check (documents the same as in the bundle and the
  ones stage 11 provisions do not count), and a module the Pi updated after the backup is kept, never
  downgraded. Runbook: `docs/dev/PLAN-B.md`, "After the night".
