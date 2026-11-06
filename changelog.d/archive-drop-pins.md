### Test kit

- **The module archive drops the pins of dropped modules:** `rehearse.mjs archive` now removes the pins of the modules on the Strahd list's `dropped` list from `pinned.json` (their files stay in the archive), so the Pi stage does not install them.
