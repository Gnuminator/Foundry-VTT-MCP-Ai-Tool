### Tests

- **Test harness, server root folder:** eight root test files that built their own logger stub (change history, change summary fixture, event pump, event pump gaps, Foundry connector, play log pump, usage log, usage pump) use the shared `makeLogger()`; the harness ratchet falls to 30 own logger stubs.
