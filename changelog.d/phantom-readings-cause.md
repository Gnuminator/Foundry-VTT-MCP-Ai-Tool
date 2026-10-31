### Tooling

- **Context alert reads the real context after an advisor call:** a response that called the
  advisor tool reports usage summed over its two sampling passes, so the context hook saw about
  twice the real context and lanes handed over far too early (210 such responses since
  2026-10-23, 40 false alerts). The hook now reads the last pass from `usage.iterations`.
