### Fixes

- **Connector installer finds the Claude Desktop config current Desktop reads:** the Store build
  of Claude Desktop now keeps its settings in `%LOCALAPPDATA%\Claude-Data\claude_<package id>\`;
  `%APPDATA%\Claude` and the `Packages\Claude_*\LocalCache\Roaming\Claude` copy are stale there, so
  entries written to them (and Cast) never showed up in Settings > Developer. The installer now
  writes the Claude-Data file first (backup of each file, other entries kept), logs which file
  Desktop reads, and still updates the older copies that exist. `-ListConfigFiles` prints the list.
  The Plan B connector switch and `repoint-connectors.ps1` default to the same file. Install guides
  (English and Danish), the installer README and the deployment notes name the right folder.
