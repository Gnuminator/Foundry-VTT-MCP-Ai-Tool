### Tooling

- **Release check tightened in the merge gate:** the release-PR exception now looks version files up
  by own key only, compares the NSIS version lines with the version blanked (a changed registry path
  no longer passes), refuses a dropped `version` field, and a killed main copy of the gate also ends
  with a `refused because` line. The lane skill describes the risky notice as it now reads.

### Fixes

- **Preflight counts older connectors against the registry's version:** the "older than the bridge"
  count and the "behind" flag now use the same current version.
- **Docs:** the control-call lists in ARCHITECTURE.md and `CONTROL_METHODS` now name `character_sheet`,
  `player_roll` and `player_portrait` besides the calls they listed, and say what `link_status` is
  for (the Pi health check). The Live Feed gets a "Roll rows" story so the roll rows show in the shots.
