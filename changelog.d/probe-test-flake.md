### Fixes

- **MCP probe test cleanup:** the modern-client probe test waits for the wrapper processes it started to exit before it removes its temp folder, and removes it with the retrying `rmTmp`. This ends the occasional `ENOTEMPTY` failure on CI.
