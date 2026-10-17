### Dev tooling

- **`lane:merge --wait-ci` lows:** a test now covers the real re-fetch case (`fetched: true`, as every real run has): exactly one `git fetch aitool main`, after the wait. The `gate()` test helper takes `fetched`. Two skill lines in the lane and planner skills are wrapped at 100 characters again.
