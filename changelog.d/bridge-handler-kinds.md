### Module

- **Bridge handlers declare their kind:** every bridge handler is registered with a kind (`write`, `recordless-write` or `read`), and the write gate reads it from the handler table instead of three hand-kept lists, so a new handler cannot be left unclassified. `queries.ts` is split into `queries/<domain>.ts`. Method names and behaviour are unchanged.
