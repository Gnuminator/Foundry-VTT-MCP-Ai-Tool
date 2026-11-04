### Fixes

- **Old Claude Desktop connectors are noticed:** the connector (wrapper) now tells the bridge which
  version it is. `get-preflight` and the dashboard Pre-flight list show a warning when a connector is
  older than the bridge or too old to say, with the fix (run the installer again).
- **A tool the connector does not know is no longer hidden:** a tool in no tool set is listed by the
  connector that serves Core, so a wrapper behind the bridge can no longer drop new tools.
- **A failed tool list is an error:** when the bridge returns no tools, Claude gets an error instead
  of an empty list.
