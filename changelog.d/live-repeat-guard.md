### Fixes

- **No double writes from a double click:** the bridge now answers the same write (same tool, same
  arguments, same requester) within 3 seconds with the first result instead of running it again, so
  a double click on Apply or Undo cannot apply a guarded write twice. Reads, plans and dice rolls are
  not held back, and a failed call can be retried at once.
