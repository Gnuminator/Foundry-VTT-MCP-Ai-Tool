### Test environment

- **A second test server for kit runs:** test server B (`C:\FoundryTestB`, Foundry 30002, bridge
  31524 and 31525, dashboard 3101) runs on the same Foundry install and licence as server A, with
  its own data folder, module copy, vault, logs and lock. `npm run kit:run` uses B by default
  (`--server A` for the old behaviour), so a long kit run no longer blocks `live:roundtrip` on A.
  Every test-env script takes `-Server A|B` (default A, or `FOUNDRY_TEST_SERVER`); the ports live
  in `scripts/test-env/servers.json`, read by the scripts and the kit. `server-b.ps1` creates and
  refreshes B from A. The start alerts hook also reports B's lock.
