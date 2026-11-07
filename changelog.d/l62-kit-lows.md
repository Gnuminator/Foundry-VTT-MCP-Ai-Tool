### Test kit

- **Console errors are blamed on the right module:** the kit follows the first stack frame that is not
  the bridge's own console wrapper, instead of any bridge path in the message or source. The
  real-character-flows scenario cleans up more safely (each undo on its own, poison on both
  actors, the side scene removed if its creation throws) and checks more (timed change still
  undoable after turns, the 0 HP rider, the usage card that names the target).
