### Tooling (L119 lows bundle)

- **Tool pointers name the set:** where a tool description points to a tool in a set that may be switched off, it now names that set: Core and Prep descriptions point to Build and Play tools (`get-compendium-entry-full`, `list-creatures-by-criteria`, `get-token-details`, `get-chat-log`, `get-recent-events`), and Play points to `get-session-log` (Prep). Pointers into Core stay bare, since Core is always on. `list-recent-changes` is titled "List applied plans".
- **Changelog fold:** every heading that starts with "Pi" or "Orange Pi" is filed under one `### Orange Pi`, so Pi entries no longer end up under four headings.
- **Board report:** the Pi stage 16 failure hint lists the `deployed` key among the accepted report keys.
- **Release notes v0.27.0:** the wire-contract line names the settings namespace and the new `deployed` board key, and the headline no longer repeats "Pi" and "lows".
