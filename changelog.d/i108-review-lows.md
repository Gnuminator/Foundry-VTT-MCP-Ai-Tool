### Fixes

- **Bridge link (#184 review lows):** a bad `capabilities` list in a module hello (over 50 entries,
  an entry over 100 characters, or the wrong type) now costs only the capabilities; the hello still
  counts. A non-active socket is served a `module-request` only when its hello names the same world
  as the active link.
