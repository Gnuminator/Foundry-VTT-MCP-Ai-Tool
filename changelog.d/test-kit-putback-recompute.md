### Test kit

- **The write flows' put-back reads the list again after each undo:** `dashboard-write-flows`
  undoes the newest change it made, then asks for the list again, up to 50 times. Before, it read
  the list once: when the Redo flow failed, the Just this undo stayed live and hid the older damage,
  so the hero ended with fewer hit points than it started with.
