### Test kit

- **`dashboard-controls`: the fold-party row passes:** `dash.during.fold-party` failed in the 2026-10-12 full
  run because the layout rows before it leave the During screen on Simple, which has no Party card. The row
  now picks Cards first. Live on test server A: 105 passed, 0 failed, 75 skipped.
