### Dashboard

- **The React dashboard is now the page at `/` (D-126):** the old page stays at `/legacy/` until after G1 (an **Old dashboard** button in the header and a link in the banner), `/next/` redirects to `/` and keeps the query, and `/player`, `/me` and `/open` are unchanged. The Obsidian plugin's plan link (`/?plan=<planId>`) now works on the React page too: it opens the plan's confirm window once GM Actions are on. The "preview" wording is gone from the header and the banner. The test kit and the demo takes open the old page at `/legacy/`.
