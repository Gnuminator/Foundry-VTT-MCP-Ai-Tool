### Changed

- **The old dashboard page is gone:** the dashboard at `/` is the only one. The "Old dashboard" button, the note under the header, the "Not on this page yet" Features card and the link in the live screen's More menu are removed. `/legacy/` now sends you to `/` (a saved link with `?token=` keeps it); none of the old page's files are served any more. The page's code (`index.html`, `app.js`, the Features cards and panel help-link data) is deleted from `packages/cogm-dashboard/public/`; the stylesheets, `/player`, `/me` and `/open` stay.
