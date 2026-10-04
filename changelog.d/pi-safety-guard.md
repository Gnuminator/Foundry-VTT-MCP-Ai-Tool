### Orange Pi (D-068)

- **A safety guard for remote commands:** a Claude Code hook (`.claude/hooks/guard-remote-commands.mjs`)
  checks every command sent over ssh, scp or rsync, including the scripts fed into it. It blocks
  what could make a machine unusable (deleting `/` or a system folder, formatting or overwriting a
  disk, removing root) and asks the user before users and groups, partitions, removing packages,
  reboots, firewall, SSH and network changes. The Pi guide lists the safety rules and the nightly
  system snapshots.
- The guide uses Raspberry Pi Imager instead of balenaEtcher (Etcher's check step crashed on
  Windows); `find-pi.ps1` waits for DietPi's first boot to finish before it records the Pi's SSH key
  (the first boot swaps the SSH server, which changed the key); stage 3 no longer leaves
  `/opt/foundry` readable only by root.
