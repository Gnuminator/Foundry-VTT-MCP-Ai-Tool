### Module (I-134)

- **Session window, review lows (#412):** an open Session window reads the state again every 15
  seconds, so a start or end made from Claude or the dashboard shows up and the window no longer
  offers a duplicate start; reopening it shows "Loading" instead of the old state; a failed Start or
  End is no longer hidden by a read that was already on its way. A start or end from the window now
  records which GM clicked in the marker line's note.
