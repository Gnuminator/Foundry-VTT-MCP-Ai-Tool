### Process

- **Lanes report in the vault:** the `lane` skill has a lane write a `- progress:` line (PR, head sha, review note) on its Backlog item at "ready to merge" and at handover, before any message, and never message a session id from its brief. The `planner` skill reads those lines, does not message idle lanes above about 150k, detaches its lanes before it hands over, and writes no planner id in briefs.
