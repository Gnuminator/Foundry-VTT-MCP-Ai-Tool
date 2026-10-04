### Fixes

- **Snapshot task survives PowerShell updates:** `scripts/pi/register-snapshot-task.ps1` points the
  task at the Store's stable `pwsh.exe` alias in `%LOCALAPPDATA%\Microsoft\WindowsApps` instead of
  the versioned install folder, which moves with every PowerShell update.
