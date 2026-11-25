### Tests

- **Faster CI:** the static checks, the script and hook tests and the Pi script checks now run as
  their own parallel jobs next to the build steps. The required check `build-test (Node 24)` keeps
  its name and turns green only when all four passed.
