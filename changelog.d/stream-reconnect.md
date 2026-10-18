### Dashboard

- **The live stream comes back by itself:** after a dashboard restart or a tunnel 502 the browser used to give up on the live stream for good, and the page stayed stale until a reload. The new dashboard, the full dashboard and `/player` now make a new connection after a short wait (2, 4, 8, then 10 seconds). The new dashboard's header says "reload the page" only after three new connections in a row failed, and still keeps trying.
