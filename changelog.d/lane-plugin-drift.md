### Tests

- **Lane kit plugin check:** `npm run plugin:check` no longer reports drift when only the tool-version prefix of the plugin version lags a release; the kit hash after the `+` alone decides, so the release PR stays clean.
