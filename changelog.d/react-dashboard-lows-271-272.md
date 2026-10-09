### Dashboard

- **React dashboard: #271 and #272 review follow-ups:** a drawer that is already open comes to the
  top again when it is asked for (the GM Actions gate's Pre-flight, the Tool runner's own gate),
  and Escape now always closes the drawer on top, not the one opened last. After Hide cards the
  Pre-flight row keeps the keyboard focus. A Tool runner Undo that GM Actions refuse focuses the
  Enable GM Actions button whether the drawer was open, under another drawer or closed. When the
  server refuses a change because GM Actions are off, the page shows them off at once instead of
  waiting for the stream. The Tool runner's form reads the server's list of tools whose confirm
  flags the confirm window answers, instead of a copy.
