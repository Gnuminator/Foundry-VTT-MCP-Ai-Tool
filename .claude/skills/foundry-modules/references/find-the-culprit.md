# Find the Culprit (`find-the-culprit`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 3.3.0, 2026-10-28 (test server B; the main window, the instructions dialog and the Zero Modules run with its reset were driven live; a full halving search was not).

**Verdict: keep.** It costs nothing until it is opened, and when the table breaks and nobody knows which module did it, it finds the module by halving the list. 3.3.0 was released for Foundry 14.360 and ran clean on 14.369.

**For Danni's guides:** If something odd happens and you do not know why, open Module Management and press "Find the Culprit"; it switches modules on and off for you and asks "is it still broken?".

## What it does

A binary search over the active modules. It deactivates half, reloads the GM's browser, asks whether the problem is still there, and repeats until one module is left. Modules can be marked Suspect, Pinned (always on), Excluded (off for the search), Exonerated or Culprit. Libraries are pinned by default (**Lock Libraries**), and it keeps a module's dependencies active. **Zero Modules** runs one sanity check with only itself active.

## Where its UI is

- Settings sidebar, **Manage Modules**, then the **Find the Culprit!** button at the bottom of the Module Management window. The first time after each page load an instructions dialog (**Continue** or **Don't Show Again**) comes first.
- Main window: Instructions, Shuffle, mute toggle, filter, one row per active module with a state button, **Clear All**, **Libraries Locked**, **Reload All** (or GM only), **Start Run**, **Zero Modules**.

## Settings we use and why

None needed. Its settings are the hidden world-level search state (`find-the-culprit.data`, `find-the-culprit.error`) and one visible client setting, Debug Level (`find-the-culprit.debugLevel`, default None); we leave them. Do not tick **Reload All** during a live session: it reloads every player too, and the default (GM only) is right for troubleshooting at the table.

## How it interacts with the AI Tool

- **The bridge goes away during a search.** `foundry-mcp-bridge` is an ordinary module, so it is deactivated in the halves where it lands. Seen live with Zero Modules: `get-world-info` answered "Foundry VTT module not connected" until the reset, then worked again about four seconds after the reload with the original 14 modules back. Pin the bridge (click its row until Pinned) if Claude should stay connected, but then it cannot be found as a culprit.
- It writes no documents; it only changes the world setting `core.moduleConfiguration` and keeps its search state in its own world setting (`find-the-culprit.data`) so a search resumes across reloads. Our change journal records nothing for it.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 13, verified 14.360. The 3.3.0 release switched to `TypedObjectField` to fix errors on 14.360.
- After its reload the GM lands on the join screen and must pick the user again; players on their own browsers stay connected (GM-only reload is the default).
- Closing a step dialog is safe: reload the page or press the button again to get it back.
- It cannot find a problem that needs two modules together; its own instructions say so.
- Removing it leaves nothing behind.
- Pi: the reload is the browser's, so Foundry on the Pi does not restart (not tried there).

## Sources

- Repo: https://github.com/esheyw/find-the-culprit
- `C:\FoundryTestB\data\Data\modules\find-the-culprit\README.md`, `CHANGELOG.md`, `module.json`, `src\`.
