### Fixes

- **Combat create guard:** when the Combat class inherits `_onCreate`, the guard now looks it up
  on the parent prototype on every call, so a patch registered after ready is not skipped.
