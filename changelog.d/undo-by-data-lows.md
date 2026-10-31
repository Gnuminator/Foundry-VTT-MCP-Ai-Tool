### Fixes

- **Undo by data, narrower tie:** only the group's own records from the first AI item delete on
  (from the first AI delete when no item was deleted) can tie another browser's dependent deletes
  to an AI change through the actor rule; a concentration end from before it stays the person's own
  action. New tests cover an item delete with the group's own concentration end, and filing by time
  among two AI changes.
