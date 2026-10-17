### Scene restore (Backlog scene-restore-big)

- **Big restores in batches:** a restore over the 200-change plan limit (Castle Ravenloft has 2,091 walls) is planned as a chain. Each plan holds the next 200 changes and says how many are left; apply it and plan again. Every batch is undone on its own.
- **`recentCopyOk`:** skips the "changed under 5 minutes ago" refusal for a hand-made copy of the world. A copy Foundry has open is still refused.
