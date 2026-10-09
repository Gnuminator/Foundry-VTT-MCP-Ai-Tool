### Test kit

- **The combat strip sweep reads Combat buttons from the server:** `dashboard-controls` read the
  setting from the page's label, which says "off" until the dashboard's prefs event lands, so an
  already-on setting could be turned off afterwards. It now reads `/api/state`, waits until the
  page shows Combat buttons on before clicking a combatant, and reports a failed put-back (Combat
  buttons off, ending the boss combat) instead of ignoring it.

### Dashboard

- **`/api/state` carries the GM's screen choices:** the GM role's state now has `prefs` (null
  until the world is known), the same as the stream's `prefs` event.
