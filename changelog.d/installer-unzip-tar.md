### Fixes

- **Installer build:** the Windows installer build now unpacks its Node.js zip with Windows' own `tar.exe` instead of `Expand-Archive`, which failed on the release runner (the v0.31.0 release build stopped at "Failed to extract Node.js").
