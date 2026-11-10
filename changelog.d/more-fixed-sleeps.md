### Tests

- **No more fixed sleeps in the dashboard and Discord bot tests:** the unit tests wait for a condition (or age files with utimes), and the browser tests use the page clock for timers and a settle step for "nothing happened" checks (Backlog `more-fixed-sleeps`).
