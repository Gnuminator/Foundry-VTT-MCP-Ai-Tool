### Test kit (D-090 lane 2)

- **Failed dashboard requests say which tool and why:** a dashboard API request that answers 400
  or more is recorded as `HTTP <status> <method> <path> <tool>: <error>` (the tool's name and the
  server's error text, never its arguments) instead of the browser's bare "Failed to load
  resource" line, so a failed control row in the report names the tool that refused.
- **Pre-flight findings on a big world:** the `dash.preflight.show-findings` row waits for the
  drawer's own run to end before it opens the findings list (on the licensed world the run ended
  after the click and drew the list again, closed).
