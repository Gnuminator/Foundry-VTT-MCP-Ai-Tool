### Test kit

- **`kit init` provisions only a Foundry on this machine:** `provisionWorld` refuses a host that
  is not loopback, because its passwordless Kit GM and Claude would be an open GM login on a host
  others can reach. A future remote target (the Pi) opts in with `allowRemote` and gives its GMs
  passwords first. TEST-KIT.md also says that an existing lower-role `Claude` is promoted to
  Gamemaster but keeps any password it has.
