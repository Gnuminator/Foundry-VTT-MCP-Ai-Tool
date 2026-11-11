### Dashboard

- **Glance view, Party rows:** name and HP sit in two columns (`1fr auto`) instead of sharing the Fight row grid, so HP is right-aligned at 390 px and 1440 px.
- **Glance view tests:** a fake-clock spec covers the "Old" marker after 45 s, "showing the last answer" after a failed re-read, and the 15 s refresh of Party and Scene.
- **Scene mood panel:** the pending refocus is dropped when the mood list changes again before it matches, and is typed as the moods list.
