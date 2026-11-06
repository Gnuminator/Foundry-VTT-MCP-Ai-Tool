### Testing

- **Real-character combat flows in the test kit:** a new kit scenario, `real-character-flows`, runs
  six combat flows against the kit's real heroes and player user: the assigned character beside a
  second owned actor, a poisoned roll with Automated Conditions, a timed condition undone after
  turns, a drop to 0 HP and its undo, a fight on a scene the GM is not viewing, and a `use-item`
  write on a client with no canvas. Five of the six fail on the code from before their fixes.
