### Fixes

- **Small tool and eval clean-ups:** asking for a tool module that is not in the module list now
  throws instead of building it silently (a module another one uses still builds on demand);
  `usage:calls` skips its connector hint when a custom log folder is set, refuses `--pi` with any
  `--dir`, and words the hint for one or several connectors; the tool eval no longer treats the
  Danish `nå` as Norwegian.
