### Changed

- **The tool call log says why a call failed:** each failed call line now carries a fixed class (`not-connected`, `timeout`, `switch-off`, `validation` or `other`), never the message text, and the backend logs the message once. `usage:week` and `usage:calls` print errors per class and the three largest results.
