### Fixes

- **Green flakes lows (from the #360 review):** on Windows `npm run green` now prints a first line that says
  which Node the steps run on (`steps on Node 22 (<folder>)`, or that no portable Node 22 was found), and
  the Node 22 pin sets exactly one PATH key even when the parent process hands over both `PATH` and `Path`.
  Two comments in the co-GM dashboard tests and `app.ts` now say that the stream tests rely on the order of
  the snapshot events, and the prefs test comment describes what it really checks.
