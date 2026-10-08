### Test kit (D-090 lane 2)

- **Module sync on save (D-102):** `sync-module.ps1 -Watch -Session <id>` runs the module's
  TypeScript build in watch mode and copies the module to the test server after every build
  change, only while that session holds the test server lock. Without the lock it says who holds
  it and copies the waiting change once the session holds it; it never takes the lock itself.
