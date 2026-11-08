### Module (L123 lows)

- **Player page:** a player who skipped the name pick still sees the "Pick your name" hint on the empty handouts list, and the header button hides when there is nobody to pick.
- **Link state:** a late settle of an older link-state write no longer overwrites the record of a newer one.
- **Recorder:** the secret key is also redacted after a colon, a space before the value, or in quotes; the silence message counts from the last packet after an unmute or a reconnect.

### Orange Pi (L123 lows)

- **Stage 23:** the two cleanups of a failed `daemon.json` write cannot stop the script silently, and "wrote" is printed after the read-back.
- **Stage 24:** the `$` and backslash rule for env values is documented in the script header and in `deploy/pi/README.md`; the rollback and down scenarios now use a relative value with a `$` and start a stack first, so they prove the way out is never blocked.
- **Seven-book baseline:** a test for a renamed source with a copy that lacks the baseline flag; clearer comments.
