### Tooling

- **Context hard stop:** a PreToolUse hook (`context-stop.mjs`) denies edits, subagents and repo-writing shell commands once a session is at or above its hand-over line, and says to hand over now.
- **Prettier on edit:** a PostToolUse hook (`format-on-edit.mjs`) formats the `.ts`, `.tsx`, `.js`, `.mjs`, `.json` or `.md` file an Edit or Write just changed, when that file was prettier-clean at HEAD or is new.
- **Phantom context readings:** `context-alert.mjs` counts a reading only when the response before it was also big, so one doubled API response no longer triggers a handover.
