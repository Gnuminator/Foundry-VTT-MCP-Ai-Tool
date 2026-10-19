### Tooling

- **ffmpeg demo recorder raises the scene's window:** with `--recorder ffmpeg`, `Take.scene()` now
  brings the scene's browser window (found by its pinned title) in front of the others, since a
  screen recording shows whatever is on top and Playwright's `bringToFront` does not raise the OS
  window. Without it every recording showed only the last window opened.
