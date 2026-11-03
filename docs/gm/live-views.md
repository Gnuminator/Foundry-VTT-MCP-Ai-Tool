---
title: The live views
description: The three ways to keep the combat strip next to Foundry (Live screen, GM page, Live window), where the Live views button is and when to use which.
---

# The live views

During a fight you want the combat order and the quick buttons (damage, conditions, the party) in
sight while you look at the map. There are three ways to do that. All three are in one place: the
**Live views** button at the top of the dashboard.

| View                      | What it is                                        | Use it when                                                          |
| ------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| **Live screen**           | One fixed dashboard page with the strip.          | You have a second screen or a tablet next to Foundry.                |
| **GM page**               | Foundry and the strip side by side in one window. | You have one screen and want one browser window for everything.      |
| **Live window** (Foundry) | A small window inside Foundry, next to the map.   | You want the strip inside Foundry and are fine with a narrow window. |

## Live screen

Open **Live views**, then **Live screen**. Nothing else to set up.

## GM page

Open **Live views**, then **GM page** (the address is `/gm` on the dashboard). Foundry loads on the
left, the strip on the right.

- **Close your normal Foundry tab first.** A Foundry user can only be joined once, so with Foundry
  already open in another tab your name is greyed out in the join list inside the page.
- Join inside the page. The yellow note "Can't see Foundry here?" on top of Foundry goes away once you
  have joined.
- The strip is 320 to 720 pixels wide, and Foundry always keeps at least 1024 pixels. Drag the divider, or use the arrow keys on it.
  Strip right, Strip left and Foundry alone switch without reloading Foundry. Your choice is kept.
- If Foundry will not open inside the page, the page offers to open it in its own tab.
- The dashboard needs to know Foundry's address (`DASHBOARD_FOUNDRY_URL`). If it does not, the
  Live views menu says so.

## Live window

The Live window lives inside Foundry. Turn it on there: the **Settings** tab, **Game
Settings**, category **Foundry AI Tool**, **AI Tool: Live window**. A **Live** button then appears in the AI Tool
group. If the window is empty, it says why and what to change; the usual cause is the setting **AI
Tool: Live window address**.

The dashboard has no switch for it yet; turn it on in Foundry.
