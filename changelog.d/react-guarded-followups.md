### Dashboard

- **React dashboard: guarded changes after the #239 review:** Escape with a toast showing closes
  the drawer or panel under it and keeps the toast, so a GM closing a drawer right after a change
  keeps the Undo button. GM Actions count as off until the live stream says otherwise (no plan
  left behind by an early click). An apply or undo that times out at the bridge says it may have
  applied and points to Recent Changes, and the panels reload in case it did. Usage logs record
  the server's failure kind (tool, timeout, channel) as the old page does.
