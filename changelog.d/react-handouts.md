### Dashboard

- **The React dashboard gets the Handouts drawer and the confirm window (D-109):** a 📜 Handouts
  button on `/next/` shows the reveal queue (the next page marked, its scene and who it is for)
  and each revealed handout with a tick for every player who has opened it, as the old page does.
  **Reveal next** opens the confirm window with the plan's summary and what it changes; a reveal
  is destructive, so **Run destructive action** waits for the "I understand" tick, and the toast
  has Undo. **Show it now** goes with one reveal and unticks after it. **Remove** takes a page off
  the queue without GM Actions. The drawer reloads after any apply or Undo (the old page left it
  stale until Refresh) and when a player opens a handout. Any one-click change whose plan is not
  an ordinary write now asks in the same window instead of sending the GM to the full dashboard.
  Queueing a page still happens on the full dashboard (**+ Queue a page** links there).
