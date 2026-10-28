### Process tooling

- **One Foundry app folder for the test servers:** the folder the test servers start Foundry from now comes from one machine-wide file, `appdir.txt` next to server A's `lock.json`, instead of each worktree's gitignored `local.json`, so every checkout runs the same Foundry version. `status.ps1` prints the version it will start and warns when a `local.json` `AppDir` disagrees; `status.ps1 -SetAppDir <folder>` writes the file.
