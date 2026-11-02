### Docs

- **Danish GM and player guides:** every page in `docs/gm` and `docs/player` has a Danish twin in
  `docs/da`, and the wiki has a Danish language switch (`/da/`). Game terms and Foundry labels stay
  English. The Foundry basics are English only; a Danish page that links to one opens it under
  `/da/` with a note that it is not translated.
- **Danish twins stay current:** each twin records a hash of its English page; `npm run docs:links`
  (CI) fails when a guide has no twin, when a twin is older than its source or when it holds an em
  dash. `node scripts/wiki/da.mjs stamp <page>` records the hash after the change is translated.
  Format and word list: `docs/da/README.md`.
