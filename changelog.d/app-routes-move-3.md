### Dashboard

- **Dashboard code tidy (no change for users):** the Cloudflare Access sign-in check, the GM-only guard and the remaining feature routes (Open in Foundry, usage log, handout seen log, player connector, My character, storage space, versions, help, session notes) moved out of `app.ts` into `src/routes/`, and the dashboard's types into `src/dashboard-types.ts`. The middleware order is unchanged; the inline route count in the ratchet went from 4 to 3.
