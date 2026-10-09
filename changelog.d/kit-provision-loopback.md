### Test kit

- **`kit init` provisions only the PC's test Foundry:** `provisionWorld` refuses anything but
  `http://127.0.0.1:30001` on Windows, because its passwordless Kit GM and Claude would be an open
  GM login on a host others can reach. A loopback address is not enough on its own (the Pi's own
  `127.0.0.1:30000` is what its tunnel serves, an SSH forward makes the Pi look local). A remote
  target (the Pi) needs a way to give its GMs passwords first; there is no opt-out. TEST-KIT.md
  also says that an existing lower-role `Claude` is promoted to Gamemaster but keeps any password
  it has.
