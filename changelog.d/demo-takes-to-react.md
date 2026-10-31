### Tooling

- **Demo takes drive the current dashboard:** the demo harness (`scripts/demo`) opens the dashboard at `/` instead of the old page at `/legacy/`, and the helpers and takes use the current page's tabs, Tool Runner, confirm window, Pre-flight and Prep drawers. The Pre-flight take shows the guides instead of the old Features cards. The helper test now checks the ids against the current dashboard source.
