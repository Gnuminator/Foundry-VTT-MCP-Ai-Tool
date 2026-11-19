### Fixes

- **Module lows sweep:** an error with no message now reports its name instead of an empty string,
  the lint message for the module's shared imports names `@gnuminator/shared/browser`, and the
  write-gate docs say which write functions call `requireWriteOperations`. Test titles, comments
  and one unused export were tidied, and the room whisper test now covers the 120 character name
  refusal.
