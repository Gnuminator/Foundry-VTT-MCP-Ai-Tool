### Orange Pi (D-068)

- **Stage 11 and `push-world.ps1` move the Strahd world to the Pi:** `scripts/pi/push-world.ps1` builds
  one checksummed `.tar` of the world, its private modules and the `ddb-images` and `tokenizer` folders
  it uses (found by `scripts/pi/world-refs.mjs`, which scans the world and the module packs for asset
  paths and stops on a missing file, a module that is not in the bundle, or a secret-looking setting)
  and uploads it to the Pi; `scripts/pi/remote/11-world.sh` checks the tar before extracting it,
  installs it, keeps old copies in `prev-<time>`, never replaces an existing campaign world without
  `REPLACE_WORLD=1`, resets a `strahd-kit` test copy, generates a root-only GM password file per
  world and provisions each world like stage 5. ddb-importer, env files and the D&D Beyond cookie
  never travel. Tested in the ARM64 container with a fake world, including crafted bad bundles.
  The PR review added: a secret word (cookie, token, secret, password, key) in a setting name is
  always a problem, whatever `-AllowSettingKeys` says; paths are checked with their exact letter case
  (Windows ignores it, the Pi does not); modules active in the world but not shipped, and a GM user
  with a password, stop the push; both scripts follow the 20 percent free space rule (warn below
  20, stop below 5); stage 11 puts `options.json` back and restarts Foundry when a run fails, and
  copies changed same-name images to `prev-<time>` before the merge.
