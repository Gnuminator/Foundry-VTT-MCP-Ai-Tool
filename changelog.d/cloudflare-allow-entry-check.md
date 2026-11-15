### Fixes

- **Start alert for a Cloudflare allow entry:** the session start hook now prints one line when
  `permissions.allow` in the main checkout's `.claude/settings.local.json` (or, in a lane, the
  worktree's own) holds an entry ending in `__execute` (the Cloudflare connector tool that can change
  the live setup) or allowing that whole connector, so an "always allow" click cannot sit there
  unnoticed. Silent when a file is missing or unreadable; other entries are never printed.
