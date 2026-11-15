### Fixes

- **Security alerts, npm side:** lockfile bumps for hono, @hono/node-server, undici, fast-uri,
  ip-address, body-parser, qs, esbuild, markdown-it, sanitize-html, smol-toml, moment and the wiki's
  astro. The zod 3 memory alert stays open until a separate zod 4 move. The test mock's
  `setProperty` now refuses `__proto__` paths.
