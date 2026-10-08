### Dashboard

- **The React dashboard gets the Pre-flight drawer (D-109):** the first drawer on `/next/`, with
  the tool's checks, the verdict on the header button, the spoiler-scan findings, the version
  banner and the hand checklist (its ticks are shared with the old page). It runs again by itself
  when Foundry comes back. Ready for session and the Tarokka "Show cards" check follow in later
  PRs. Playwright covers the drawer, including the real route with the bridge down.
