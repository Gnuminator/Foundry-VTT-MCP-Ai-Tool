### Tests

- **Test harness, server root folder:** the nine root test files that built their own logger stub (change history, change journal pump, change summary fixture, event pump, event pump gaps, Foundry connector, play log pump, usage log, usage pump) use the shared `makeLogger()`; the harness ratchet falls to 29 own logger stubs.
