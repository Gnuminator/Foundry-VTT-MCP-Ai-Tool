### Player connector

- **Wrapper and player skill review fixes:** the player connector now treats a 200 reply with no
  result or error as unreadable, asks the player to paste the Client ID and Secret again when they
  hold a stray special character, shares one new session between calls that go stale together,
  passes on a JSON-RPC error from that restart, flushes the last reply at exit and leaves quietly
  when Claude Desktop closes the pipe. The player skill drops server and module provenance text
  and its unused project instructions, and builds are checked against the player tool set in
  `tool-sets.ts` and against the pages `SKILL.md` names.
