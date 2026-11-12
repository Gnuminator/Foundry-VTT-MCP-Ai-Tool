### Dashboard

- **Dashboard code tidy (no change for users):** the page and static-file routes and the read side of the API (health, state, streams, theme) moved out of `app.ts` into `src/routes/`; the inline route count in the ratchet went from 25 to 12.
