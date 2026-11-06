### Node 24 clean-ups (node24-pin-safe-check, arm-usage-catalog-step, dockerfile-node24)

- **The portable Node pin skips unsafe folders:** `npm run green` and the test-environment scripts only pick a
  portable Node 24 folder from 24.22 up; a folder holding only 24.15 is ignored and the green note says
  "no portable Node 24.22+ found".
- **ARM job:** the comment on its usage catalogue step says why the step stays.
- **Docker:** the LiveKit recorder image is `node:24-alpine`, and the Obsidian O4 design note says the floor is Node 24.
