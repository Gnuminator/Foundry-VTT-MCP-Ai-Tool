### Dashboard

- **Browser test mocks follow the real routes:** the dashboard's e2e fakes for pre-flight, switches, space, GM page, player names, player links, features and theme are typed from the response types the routes themselves answer with (`src/api-bodies.ts`), so a route that changes its answer breaks the spec at type check instead of the page live. Mocks that had already drifted (pre-flight versions and scan rows, switches `ready`/`changed`/`failed`, theme list, space reason, link dates) are fixed.
