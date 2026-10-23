### Process tooling

- **Lane heartbeat:** `npm run lane:beat -- "<lane>" "<step>"` (`scripts/lane-beat.mjs`) writes `- last seen: <date time> <step>` under the lane's claim in the vault Backlog at each milestone (claimed, PR open, review, fixes, ready to merge, handed over; the `lane` skill says when), so the PM board's lane card shows the step and its age and its stale rule counts it. A vault problem only prints a warning.
