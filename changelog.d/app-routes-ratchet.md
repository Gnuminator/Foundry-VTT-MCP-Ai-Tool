### Dashboard

- **Route ratchet for `app.ts`:** a test counts the inline `app.<method>(` calls in the dashboard's `app.ts` and fails when the number goes up, (routes and middleware), so new endpoints go in a routes module instead (pick R8).
