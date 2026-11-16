### Tests

- **Test harness, server root folder:** seven root test files that built their own logger stub (change history, change summary fixture, event pump, event pump gaps, play log pump, usage log, usage pump) use the shared `makeLogger()`; the harness ratchet falls to 31 own logger stubs. The change journal pump and Foundry connector tests stay out (bridge link paths need an Opus review).
