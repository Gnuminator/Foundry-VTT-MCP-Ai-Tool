### Dashboard

- **Screen readers keep hearing "Loading…" (React dashboard):** a panel's body is no longer marked
  busy while it loads, because a busy parent can make a screen reader hold back the "Loading…"
  message inside it.
- **Standing conditions are a status, not an alert:** when the bridge is down or a switch is off,
  the panel now says so politely instead of interrupting. A real error is still an alert.
- Tests now cover the "Close (Esc)" tip on a drawer's close button and the roles inside a list.
