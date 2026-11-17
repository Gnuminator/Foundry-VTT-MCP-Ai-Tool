### Fixes

- **Story shots report:** a story shard that times out or crashes now lists the stories it never reached as "not rendered" instead of leaving them out. Tests cover the dashboard-e2e shard names in the merge gate, and ARCHITECTURE.md names the standalone `addActorsToScene` handler.
