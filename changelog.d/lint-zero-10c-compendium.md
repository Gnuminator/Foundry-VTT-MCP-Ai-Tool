### Module

- **Lint cleanup in the compendium search:** `data-access/compendium.ts` and `data-access/types.ts` carry real types for creature filters, search hits and compendium documents instead of `any` (194 lint warnings gone). Types only; search results are unchanged.
