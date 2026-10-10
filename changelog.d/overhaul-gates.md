### Development

- **One keep-green command and a merge gate (D-122 phase 2):** `npm run green` runs what CI's
  build-test job runs and prints one line (a test keeps it in step with `ci.yml`);
  `npm run lane:merge -- <PR>` merges only with every check green on the head commit, a review
  note for that commit (Opus for risky paths), a changelog fragment, a clean drift check and room
  in the merge train; a context hook prints one line at the 350k and 400k handover marks;
  `npm run usage:week` reports startup size, tokens per merged PR and cost per weekly percent
  against the D-122 targets.
