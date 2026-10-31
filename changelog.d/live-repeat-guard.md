### Fixes

- **No double writes from a double click:** the bridge answers a repeated Apply, Undo or session
  start or end (same arguments, same person) within 3 seconds with the first result instead of
  running it again, so a double click cannot apply a guarded write twice. Other tools, such as
  attacks, dice rolls and Next turn, run every time, and a failed call can be retried at once.
