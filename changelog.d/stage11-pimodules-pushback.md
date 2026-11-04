### Tooling

- **Stage 11 container test covers a push-back with a `pi-modules:` line:** the push-back scenarios
  now add their lines to the bundle's manifest instead of overwriting it, and a new scenario
  checks that a Plan B push-back still reports "modules already on the Pi" and leaves the Pi's
  own module copy untouched.
