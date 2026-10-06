### Demo recordings (GM video polish)

- **Quarter-frame glitch fixed:** `t.shot` no longer calls `page.screenshot` on the window OBS is
  recording (it made the page draw at 1x for a few frames, so the recording showed the picture in
  the top-left quarter of the frame, once per shot). The PNG is cut from the finished video instead.
- **Cursor and click ring:** the demo cursor is now a smoothed blue dot with a ripple ring on every
  click (CSS only).
- **Focus boxes in `steps.json`:** a step records the box (fractions of the frame) and time of the
  last element `humanClick`, `humanHover` (new) or `humanType` worked on, for an automatic zoom in
  the video; `t.focus(locator)` picks the element by hand.
