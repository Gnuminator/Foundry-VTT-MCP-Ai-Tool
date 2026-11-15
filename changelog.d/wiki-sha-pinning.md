### Fixes

- **The wiki deploys again:** the Wiki workflow failed on every merge to main since 2026-11-12 because the Pages upload action calls another action by tag, which the repository's pinning rule refuses. Its steps are now written out in `wiki.yml` with pinned actions, and a test bans that action.
