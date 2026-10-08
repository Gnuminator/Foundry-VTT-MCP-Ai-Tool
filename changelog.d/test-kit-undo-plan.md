### Test kit

- **The undo window clicked for real:** `dashboard-write-flows` has three new flows on the Everyone
  tab of Recent Changes. Two damage changes on one hero: Undo on the older one asks to choose,
  Cancel and Escape change nothing, Just this gives back only its own hit points; Redo asks for
  the destructive tick, Escape and Cancel keep it undone, Confirm takes the hit points again;
  Everything since puts the hero back to before both. The put-back at the end leaves the kept undo
  alone. `dashboard-controls` names these flows for the controls it skips.
