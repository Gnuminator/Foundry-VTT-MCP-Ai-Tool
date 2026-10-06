### Orange Pi (D-068)

- **world-refs false alarms (push-world stage 11):** a GM user whose stored password is Foundry 14's
  hash of the empty string (it keeps a hash and `passwordSalt` even with no password) no longer counts
  as having a password; the salt is read but never printed. `nue/defaultscene/*` counts as one of
  Foundry's own files. Strings under a document's `flags.ddb` (D&D Beyond importer metadata such as
  `assets/cos1302.jpg`) are no longer collected. New `--allow-missing a,b*` (and `-AllowMissing` in
  `push-world.ps1`) for a reviewed list of known missing paths: matching paths are no problem of any
  kind, are counted in `allowedMissingCount`, and the list is written into `MANIFEST.txt`.
