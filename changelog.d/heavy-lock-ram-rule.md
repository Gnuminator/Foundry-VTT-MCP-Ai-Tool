### Tooling

- **The heavy lock stops counting a running holder's memory twice:** another run is admitted when
  the PC has, for each holder, only the part of its expected peak it has not used yet (estimated
  from the fall in free RAM since it was admitted), plus the reserve. Before, a green that already
  used 3 GB was still reserved at the full 5 GB on top of a free-RAM figure that excluded those 3.
  Pre-push and lint-ratchet holders count at a lower peak (`lightPeakGb`, 3.5 GB, settable in
  `~/.foundry-ai-tool/heavy-lock.json`). Each admission now records the free RAM at that moment.
