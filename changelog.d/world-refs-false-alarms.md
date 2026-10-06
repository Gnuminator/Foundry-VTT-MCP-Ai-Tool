### Orange Pi (D-068)

- **world-refs false alarms (push-world stage 11):** a GM user whose stored password is Foundry 14's
  hash of the empty string (it keeps a hash and `passwordSalt` even with no password) no longer counts
  as having a password; the salt is read but never printed. `nue/defaultscene/*` counts as one of
  Foundry's own files. Strings under a document's `flags.ddb` (D&D Beyond importer metadata such as
  `assets/cos1302.jpg`) are no longer collected. New `--allow-missing a,b*` (and `-AllowMissing` in
  `push-world.ps1`) for a reviewed list of known missing paths: a path that is really missing on disk
  and matches is no problem, is listed and counted in `allowedMissingCount`, and the list is written
  into `MANIFEST.txt`. A `*` needs a root and a folder before it (`modules/*` is refused), a
  wrong-case path stays a problem, and a path in an unknown root is now looked up on disk: one that
  exists (for example under `Data/assets/`) is reported as present but outside the bundle and can
  never be allowed.
