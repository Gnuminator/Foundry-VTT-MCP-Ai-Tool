### Dashboard

- **`app.ts` is wiring only:** the feed handlers, world refresh, player stream broadcasts and the
  Recorder and Play log dots moved into `src/live-state.ts` behind accessors, so `app.ts` went from
  512 to 193 lines with no change in behaviour. A line ratchet keeps it under 300 and from growing
  (Fable review pick R8, item `app-live-state-split`).
