### Tooling

- **Release check tightened in the merge gate:** the release-PR exception now looks version files up
  by own key only, compares the NSIS version lines with the version blanked (a changed registry path
  no longer passes), refuses a dropped `version` field, and a killed main copy of the gate also ends
  with a `refused because` line. The lane skill describes the risky notice as it now reads.
