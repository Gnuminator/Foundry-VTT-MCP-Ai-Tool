### Tests

- **Kit negative control:** `kit run --fake --stopped-bridge` runs every scenario against a dead
  bridge, dashboard, GM page and browser, and a unit test fails if any scenario of any size still
  passes or skips. Today all 29 fail, so none tests nothing.
- **No fixed sleep in the me-route test:** it waits for the world to be loaded instead of 200 ms.
