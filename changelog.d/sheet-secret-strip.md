### Fixes

- **Secrets on the "My character" sheet:** a secret block with another section inside it no longer
  shows its tail to the player. The module now drops secret elements with everything nested in
  them (any tag with a `secret`, `gm-only` or `gm-note` class, and `secret-block`), plus HTML
  comments (#155 review point 6).
