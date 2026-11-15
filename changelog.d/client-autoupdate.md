### Installer

- **Opt-in automatic update of the GM client (layer 3):** `client-update.ps1` ships with the
  installer and is started by the tunnel logon task. It stays off until `-Action Enable` creates
  `autoupdate.on`. When on, it reads the table's version through the tunnel (`wrapper_status`),
  and only if the table is newer and Claude Desktop is closed it downloads that release's
  installer from GitHub, checks it against `SHA256SUMS.txt`, installs silently with the stored token
  kept, and restores the old files if the installer fails. One line per run goes to `update.log`
  (item client-autoupdate).
