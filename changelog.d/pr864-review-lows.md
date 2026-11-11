### Fixes

- **Link state notice:** a link state write that finished after a newer one no longer logs a false "Could not share the link state" warning, and a "lost" sent while an "up" write is still in flight is written instead of skipped.
- **Voice log redaction:** `secret_key='...'` in single quotes is redacted too.
- **Pi compose docs:** the stage 24 header and `deploy/pi/README.md` list all seven names whose `$` or backslash values are refused.
