### Dashboard

- **A GM behind Cloudflare Access stays on the GM page when the sign-in cannot be checked:** when the
  dashboard cannot verify the Access token it was sent (the keys did not load, they rotated, or
  GM_EMAILS is set without the CF_ACCESS settings), `/api/state` marks the answer and both GM pages
  stay put instead of sending the browser to the player view. A reload heals a rotated key; a missing setting still needs the fix, and the page says so (#346 follow-up).
- **The GM pages say why they are empty on a stale GM link:** one line under the header, "This
  browser's GM link is not accepted any more. Open the GM link again." (the old and the new page).
