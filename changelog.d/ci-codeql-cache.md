### Tooling

- **CodeQL cache cleanup:** a new workflow, `codeql-cache-cleanup.yml`, deletes old
  `codeql-overlay-base-database-*` Actions caches nightly and after CodeQL runs, keeping the newest
  two per branch, config and language. CodeQL saves a JavaScript cache of about 330 MB on every push
  to main and never removes the old ones, so 60 of them filled 9.4 GB of the repo's 10 GB cache
  limit and evicted the npm caches. The job fails if a cache it tried to delete is still there.
