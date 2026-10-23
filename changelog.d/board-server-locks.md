### Process tooling

- **Test server locks on the PM board:** `scripts/test-env/lock.ps1` writes each test server's lock state (A, B, C: free or held, the holder's title, since when, queue length) to the vault note `Dev/Foundry AI Tool/Test servers.md` on every take, release (steal included), queue and leave, and `lock.ps1 publish` writes it again. A vault problem only prints a warning and never fails the lock.
