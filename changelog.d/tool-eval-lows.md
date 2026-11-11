### Fixes

- **Tool eval review lows:** a crashed or timed-out run now fails its gates instead of passing
  the no-write gate, every `ANTHROPIC_` and `CLAUDE_CODE_USE_` environment key is removed before
  `claude` starts, a missing `claude` binary exits with code 2, the Norwegian check works around
  `nå` and `også`, the four prep write tools count as writes, and the "Play is off" check needs
  Play next to the connector or switch wording.
