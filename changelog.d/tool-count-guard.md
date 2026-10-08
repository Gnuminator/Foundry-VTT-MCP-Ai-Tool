### Fixes

- **Tool counts that cannot drift:** the README table said the core set has 20 tools when it has 22, and two code comments still carried tool counts and sizes from before the catalog shrank. The comments no longer hold numbers, and a new test checks every tool count and size in the README and in the tool-sets reference against the real catalog, so a stale number fails the build.
