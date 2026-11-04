### Fixes

- **Probe test no longer flakes on cleanup:** the MCP modern probe test waits for the wrapper processes it starts to exit, then removes its temp folder with retries, so CI stops failing now and then with `ENOTEMPTY`.
