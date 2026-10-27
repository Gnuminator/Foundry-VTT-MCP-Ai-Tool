### Fixes

- **Bridge link:** a response frame from the module with no `data` now rejects its pending query with "Query response had no data" instead of deleting it and throwing, which left the tool call waiting forever (its timeout had already been cancelled).
