### Orange Pi (D-068)

- **Stage 7, the GM vault and Syncthing** (`scripts/pi/remote/7-vault.sh`): points the bridge's
  Obsidian output at `/var/lib/foundry-ai-tool/obsidian/gm` (`bridge.env` and `dashboard.env`, the
  services restart only when a file changed) and runs Syncthing from Debian as its own service
  (`foundry-ai-tool-syncthing`, user `foundry`, files in `/var/lib/foundry-ai-tool/syncthing`, never
  in Foundry's data folder). UPnP, usage reports and crash reports are off, relays and global
  discovery are on, the web page listens on loopback. The vault folder `foundry-gm-vault` syncs in
  both directions, so the GM's `Prep/` notes reach the Pi's backups. `PEER_ID` and `PEER_NAME` add a
  PC's device and share the folder with it. The Foundry mirror switch stays off.
- **`scripts/pi/setup-syncthing-pc.ps1`:** sets up the receiving PC: a hidden "Syncthing" task at
  logon (it finds the winget `syncthing.exe` at every start, so an upgrade does not break it), the
  same options, the Pi as a device (discovery plus its Tailscale name), the folder at
  `Documents\Obsidian\Foundry GM vault` and the `.stignore`; prints the PC's device ID. `-Remove`
  takes the task away. The Pi runs Syncthing 1.x and a winget PC 2.x (same protocol; the container
  test used 1.x on both sides).
