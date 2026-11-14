### Fixes

- **CI survives a short DNS failure when installing Chromium:** the dashboard browser test job retries the Playwright install with backoff, falls back to installing without apt, caches the browser download, and launches Chromium once from the dashboard workspace so a missing library fails the install step (`ci-chromium-dns`).
