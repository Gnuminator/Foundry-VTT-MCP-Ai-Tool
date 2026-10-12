### Fixes

- **A dashboard test no longer depends on the checkout's file ids:** the "Open in Foundry" page
  header test passes on a Windows checkout whose file ids are above 2^53, as it already did on
  Linux and in CI.
