### Module (I-108 part 1)

- **"AI changes" window inside Foundry:** GMs get an **AI Tool** group in the left toolbar (scene
  controls) with an **AI changes** button. It opens the same list as the dashboard's Recent
  Changes (newest first, 20 and a Show more for 100, diff lines, **Undo** with a confirm), refreshes
  by itself when the AI makes or undoes a change, and works from the GM's own browser even though
  only the Assistant GM browser holds the bridge link: the request is relayed through Foundry's
  GM-only `user.query` to that browser.
- **New link frames `module-request` and `module-reply`** (additive, outside the core frame union):
  the browser that holds the link can ask the backend to run `list-recent-changes` or `undo-change`
  for a GM. The backend accepts them only from the active module socket, only for those tools, with
  at most 20 kB (UTF-8 bytes) of arguments, and runs them through the same dispatch table as the
  control channel. An undo from the window records the GM's name on its audit entry
  (`requestedBy`).
- **The window refreshes when the backend has recorded the change**, not after a timed guess: the
  backend calls the module query `aiChangesUpdated` after every recorded apply or undo.
- **Any GM mode:** a GM browser whose bridge link is not the active one (the bridge serves the
  newest) now asks the browser that holds the active link, and the search carries on past a browser
  that cannot answer.
- **Old bridge, new module:** the bridge sends a `bridge-hello` listing what it supports when a
  module connects; against an older bridge the window says "Update the AI Tool bridge to use this
  window." at once instead of waiting 30 seconds.
