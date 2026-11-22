### Testing

- **The kit says what covers each control it never clicks:** every `write` and `skip` row of the dashboard and player control table now names the spec or scenario that covers it, "by hand", or "none". A unit test fails when the named file does not mention the control, and the dashboard-controls report lists the by-hand and uncovered rows.
