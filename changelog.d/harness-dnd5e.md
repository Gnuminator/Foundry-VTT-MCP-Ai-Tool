### Tests

- **Test harness, dnd5e tools folder:** the three `tools/dnd5e` tests call the shared `makeTools` directly through thin helpers instead of local `makeTools` factories; the harness ratchet falls to 19 own `makeTools`.
