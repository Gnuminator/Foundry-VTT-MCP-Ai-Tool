### Module

- **Lint cleanup in the module's query layer:** `queries.ts` and `data-access.ts` no longer use `any` (259 lint warnings gone). Types only; the bridge handlers behave as before.
