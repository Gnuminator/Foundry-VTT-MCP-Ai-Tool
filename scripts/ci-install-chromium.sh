#!/usr/bin/env bash
# CI only (build-test): install Chromium for the dashboard browser tests.
# The runner sometimes cannot resolve the Ubuntu apt mirrors for a minute or two, which failed
# whole runs. Retry with backoff; the last try skips apt (--with-deps) and relies on the system
# libraries the runner image already has.
set -eo pipefail

installed=0
for attempt in 1 2 3 4; do
  # A hung apt or download counts as a failed attempt (5 minutes each).
  if timeout 300 npm exec -w @gnuminator/cogm-dashboard -- playwright install --with-deps chromium; then
    installed=1
    break
  fi
  echo "::warning::playwright install --with-deps failed (attempt $attempt of 4)"
  if [ "$attempt" -lt 4 ]; then
    sleep $((attempt * 20))
  fi
done
if [ "$installed" = 0 ]; then
  echo "::warning::falling back to playwright install without apt"
  timeout 300 npm exec -w @gnuminator/cogm-dashboard -- playwright install chromium
fi

# Fail here, not later in the tests, if Chromium cannot start (missing libraries after the
# apt-free fallback, or a bad cache restore).
node -e "require('@playwright/test').chromium.launch().then(b => b.close())"
