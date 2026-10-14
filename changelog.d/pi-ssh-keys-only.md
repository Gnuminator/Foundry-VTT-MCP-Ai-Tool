### Orange Pi (D-123)

- **Stage 15, SSH with keys only** (`scripts/pi/remote/15-ssh-keys-only.sh`): before the Cloudflare
  tunnel goes live, the Pi's SSH server stops taking passwords. A drop-in,
  `/etc/ssh/sshd_config.d/00-foundry-keys-only.conf`, sets `PasswordAuthentication no`,
  `KbdInteractiveAuthentication no` and `PermitRootLogin prohibit-password`; the main `sshd_config`
  is not edited. The stage refuses unless root has a valid key and the main config includes the
  drop-in folder, checks `sshd -t` after writing and `sshd -T` for root after that (an earlier line
  or a `Match` block that overrides a value rolls the drop-in back and lists the lines that win),
  then reloads ssh (not a restart: open sessions stay up) and prints the effective values. Like
  stage 9 it arms a 5-minute safety timer that removes the drop-in unless a new key-only connection
  confirms (`CONFIRM=1`); `UNDO=1` removes it. The console login with the root password still works.
  Safe to run again. Tested in the ARM64 container with the real OpenSSH server
  (`scripts/pi/container-test/ssh-keys-only-scenarios.sh`); the command guard's test lists stage 15
  as an "ask". Not yet run on the Pi.
