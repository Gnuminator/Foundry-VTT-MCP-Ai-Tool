### Dashboard

- The new dashboard's Before / During / After tabs stay correct when the bridge is down: After now turns into Before after 12 hours even if every check of the session fails, and a hidden browser tab keeps checking once a minute so the moment is current when you come back.
- In the neutral theme the selected moment tab has its ring and glow again.
- The old dashboard page now reads when the session ended from the bridge, as the new page does, instead of a value kept in the browser, so the two pages agree on After.
- Tests: the new dashboard's view and Tool runner tests wait for the right moment before they count calls or reopen a drawer, so they no longer depend on timing.
