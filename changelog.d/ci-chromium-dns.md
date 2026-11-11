### Fixes

- **CI survives a short DNS failure when installing Chromium:** the dashboard browser test job retries the Playwright install with backoff, falls back to installing without apt, and caches the browser download (`ci-chromium-dns`).
