### Tooling

- **The wiki build gets a Node that Astro accepts:** the wiki workflow asks for Node 22.23.4
  exactly. A bare "22" gave some runners 22.23.3, which Astro refuses, so the wiki check went red on
  some days and green on others. A test keeps the pin at or above the wiki's own Node floor.
- **`green --quick` lints what you changed:** ESLint on the changed TypeScript files, markdownlint
  on the changed Markdown, and the link and Danish twin check when any Markdown changed. A change to
  the ESLint, Prettier or markdownlint config, the ESLint tsconfig or the lockfile lints everything.
  Lint errors in the files you changed now show up before the push, not first on CI.

### Fixes

- **Session marker screenshots stop flickering:** the "Starts the session" and "Ends the session"
  stories repaint the toast stack once and pause the toast timers before the shot. The first
  toast's bottom edge sits on a fraction of a pixel and Chromium put it on either of two rows from
  run to run, however long the story waited.
