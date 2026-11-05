### Module

- **Tarokka table, kept line:** a failed restore of the line you typed no longer reports a successful flip as failed. A kept line is dropped after about 2 seconds when its card never shows as flipped (an Undo), so a later reveal of the same card does not bring it back. A new flip clears the kept line of the same card and old or other-reading ones, not every one.
- **Link toasts:** when the AI Tool server could not be reached at start, the "link is back" toast now follows once the link opens. More tests for the toast timing and the wiring in the module.
