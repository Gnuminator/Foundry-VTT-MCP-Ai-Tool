### Tooling

- **Weekly pace by active hours:** `npm run usage:now` now writes `pace-expected-percent`, `pace-delta`, `pace-projected-percent`, `pace-active-hours-left` and `pace-profile-weeks` from an hourly weekday and weekend profile built from the usage log (Copenhagen time, smoothed, with a fallback table for a short log). `usage:week --json` carries the profile and the pace, and the planner skill judges the week by it instead of a flat 14% a day (Backlog `pace-active-hours`).
