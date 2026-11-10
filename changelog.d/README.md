# Changelog fragments

Each pull request adds its CHANGELOG entry here as its own file instead of editing
[CHANGELOG.md](../CHANGELOG.md), so two pull requests never change the same lines (D-089).

- **File name:** the branch or topic, for example `i100-library-by-book.md`. One file per pull
  request.
- **Content:** one or more `### Heading` sections, each with bullets, written exactly as they should
  appear under "Unreleased". Use a heading that already exists there (`### Dashboard`,
  `### Module`, `### Fixes`) to add to it, or a new one for a new area:

  ```markdown
  ### Obsidian

  - **The Library by book:** the Library is sorted by kind, then by book, with `book` and `page`
    properties (I-100; PR #103).
  ```

- **Item and PR references go in the bullet, not the heading tag:** the fold drops a trailing
  `(...)` tag from a new heading, so a reference there never reaches CHANGELOG.

- **Fold tidies headings:** when a heading is new in "Unreleased", the fold writes it without its trailing
  `(...)` tag, Testing, Test kit and Test environment go under
  `### Tests`, and every heading that starts with Pi or Orange Pi goes under `### Orange Pi`. Headings already in "Unreleased" are left as they are.
- **Check:** `npm run changelog:check` (CI runs it). **Fold:** `npm run changelog:fold` moves every
  fragment into CHANGELOG "Unreleased" and deletes the files; run it before a release, or whenever
  "Unreleased" should be current (`npm run changelog:fold -- --dry-run` shows the result first).
