### Fixes

- **Live check line in the merge gate:** a PR that touches the Module source or the Pi stage
  scripts is refused unless its description has a `Live check:` line naming the live run (or why
  there was none). The PR template carries the line.
