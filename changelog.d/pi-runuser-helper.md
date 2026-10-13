### Orange Pi

- **Stage scripts no longer write in the foundry user's folders as root:** `lib.sh` has one helper
  that edits a JSON file as the foundry user (temp file plus rename, mode kept, the foundry user as owner) and one
  that copies a file the same way. Stage 5's check world, stage 11 (`set_world`, the kit world's
  `world.json`), stage 12 (the saved copy of `options.json`, putting it back, the proxy options),
  stage 13 and the kit session use them, so a link left at a temp name or at an asset name is never
  written through. Stage 11's asset merge uses `cp --remove-destination`. Stage 12's backup copy of
  `options.json` is now owned by the foundry user. The temp name is `options.json.foundry-tmp` for
  all of them. The change reaches the Pi on the next run of each stage.
- **Stage 5 checks the new build before it stops anything:** after the prune it loads one module of
  the bridge, the dashboard (including its server-only AI client) and the shared package from the build, so a runtime package the prune
  took away stops the stage with the failing package named, while the services and the old copy
  are untouched.
