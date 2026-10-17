### Fixes

- **The bridge control port ignores web pages:** a web page in the GM's browser can POST to
  `127.0.0.1:31414` without a preflight, and a JSON line in the body would have run as a tool call
  (review of PR #344, M1). The control channel now closes the connection when the first line is not
  a JSON object, or when a line that is not JSON looks like HTTP. The stdio wrapper, dashboard,
  tunnel ping and test kit all start with a JSON line and are unaffected.
