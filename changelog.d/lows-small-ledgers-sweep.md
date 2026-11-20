### Fixes

- **Picture links:** `plan-actor-image` now refuses a link whose target is not a drive path or a relative path on Windows, and skips its link walk only for a file that is itself in a network folder; tests cover a local junction chain, and the PC-creation test fixtures use neutral names.
