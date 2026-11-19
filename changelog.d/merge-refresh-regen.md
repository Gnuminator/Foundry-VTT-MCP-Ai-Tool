### Process

- **The merge runner regenerates the tool pages itself:** a PR that fell behind main because both
  added a tool no longer needs a lane turn. The runner takes the lane's side of a conflict in the
  generated tool pages, runs `npm run docs:tools`, commits it in the refresh merge and the gate
  runs again. Any other conflict, a failing regeneration or a baseline that would go up is refused
  as before. The gate's review carry ignores the generated tool pages (I-158).
