### Module (I-134)

- **Two more GM windows, behind the same "GM windows" switch (off by default):** "Session" shows
  whether a play session is open and has Start and End buttons (the dashboard's session marker), and
  "Scene" shows the active scene's light, weather and what is playing. The Session window asks the
  bridge through two new module-request tools, `get-play-session` and `mark-play-session`; a mark
  from the window carries only the action (start or end) and a short note, and writes one line to the
  bridge's session log. Needs a bridge from this release to use the Session window.
