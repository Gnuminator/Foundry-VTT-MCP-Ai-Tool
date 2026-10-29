### Tooling

- **CodeQL cache cleanup:** a new workflow, `codeql-cache-cleanup.yml`, deletes old
  `codeql-overlay-base-database-*` Actions caches after every CodeQL run (and nightly), keeping the
  newest two per language. CodeQL saved one 330 MB cache per push to main and never removed them, so
  60 of them filled the repo's 10 GB cache limit and evicted the npm caches.
