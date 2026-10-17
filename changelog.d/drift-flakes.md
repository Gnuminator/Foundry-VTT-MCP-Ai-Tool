### Fixes

- **Two flaky mcp-server tests under load:** the prep digest test no longer gives the prep notes a 200 ms deadline, and the many-notes mirror scan test has its own timeout.
