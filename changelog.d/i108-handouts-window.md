### Module (I-108 part 2)

- **"Handouts" window inside Foundry:** the **AI Tool** group in the scene controls gets a
  **Handouts** button (GMs only). The window lists the reveal queue (oldest first, with the scene
  and the players each page is for, and **Remove**), has one **Reveal next** button for the active
  scene with a **Show it now** tick that is unticked every time the window opens or redraws and
  after each reveal, and shows who has read which revealed page. Reveal asks you to confirm in a
  Foundry dialog that shows the plan's summary and diff, then applies it; cancel does nothing. The
  window refreshes when the backend records a change and has a Refresh button, and works from the
  GM's own browser through the same relay as the AI changes window.
- **Module requests can now plan and apply a handout reveal, and nothing else:** `MODULE_REQUEST_TOOLS`
  adds `list-revealed-pages`, `plan-page-reveal` and `apply-planned-change`, and the backend narrows
  them (`MODULE_PLANNERS` in `module-requests.ts`). A module request may run `plan-page-reveal` only
  with `reveal-next` or `unqueue`, and may apply only a plan that such a planner made through a
  module request (checked through the guarded-write service, feature included). Adding the Tarokka
  reveal later is one line. An apply from a window records the GM's name on its audit entry
  (`requestedBy`), like an undo does; relayed applies get the 120 second timeout.
