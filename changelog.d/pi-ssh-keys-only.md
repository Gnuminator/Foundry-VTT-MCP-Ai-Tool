### Orange Pi (D-123)

- **Stage 15, SSH with keys only** (`scripts/pi/remote/15-ssh-keys-only.sh`): before the Cloudflare
  tunnel goes live, the Pi's SSH server stops taking passwords. A drop-in,
  `/etc/ssh/sshd_config.d/00-foundry-keys-only.conf`, sets `PasswordAuthentication no`,
  `KbdInteractiveAuthentication no` and `PermitRootLogin prohibit-password`; the main `sshd_config`
  is not edited. The stage refuses unless root has a valid key that sshd really accepts, the main
  config includes the drop-in folder, ssh is not socket-activated and no `Match` block sets a login
  value; it checks `sshd -t` after writing and `sshd -T` for root from three addresses after that
  (an earlier line that overrides a value rolls the drop-in back and lists the lines that win). Like
  stage 9 it then arms a 5-minute safety timer (it puts the old settings back and starts ssh if it
  is down) unless a new key-only connection confirms (`CONFIRM=1`), reloads ssh (not a restart: open
  sessions stay up), asks the running sshd what it offers and prints the effective values; `UNDO=1`
  removes the drop-in. The console login with the root password still works. A rerun checks the
  safety net: a timer still armed is left armed, a lost one is re-armed, a confirmed drop-in only
  reloads. Tested in the ARM64 container with the real OpenSSH server
  (`scripts/pi/container-test/ssh-keys-only-scenarios.sh`); the command guard's test lists stage 15
  as an "ask". Not yet run on the Pi. The Pi stage command lines in `PI-SETUP.md` are now marked as
  Git Bash (PowerShell's `cat` sent the Pi nothing).
