### Dashboard

- **GM health line:** the GM page (also the Foundry window B), the strip alone, the Live view and the Dashboard header show one line with four dots: Dashboard (this page's live link), Bridge, Foundry (with "down since" when it is away) and Last update. The server repeats the bridge status every 17 seconds, and a page that hears nothing for 45 seconds says it is not live. The strip says "The bridge is away." instead of "No fight." when the bridge is away, `/api/health` now reports the Foundry state, and a crash in the page shows a reload message instead of a blank screen.
