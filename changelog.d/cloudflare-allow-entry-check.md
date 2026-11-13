### Fixes

- **Start alert for a Cloudflare allow entry:** the session start hook now prints one line when
  `permissions.allow` in the main checkout's `.claude/settings.local.json` holds an entry ending in
  `__execute` (the Cloudflare connector tool that can change the live setup), so an "always allow"
  click cannot sit there unnoticed. Silent when the file is missing or unreadable; other entries are
  never printed.
