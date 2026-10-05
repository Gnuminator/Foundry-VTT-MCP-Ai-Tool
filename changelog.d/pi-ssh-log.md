### Orange Pi (D-068)

- **Stage 9, a log of SSH commands** (`scripts/pi/remote/9-ssh-log.sh`): every login with the PC's
  key runs through `/usr/local/sbin/foundry-ssh-log` (a `command=` prefix on the key line;
  `sshd_config` is not touched), which writes one line per command to
  `/var/lib/foundry-ai-tool/ssh-log/ssh-commands.log` and keeps a copy of every `bash -s` script,
  then runs the command unchanged; sftp and interactive logins pass through. It fails open. Root
  only, rotated weekly, 12 weeks kept. The switch arms a 5-minute timer that restores the old key
  file unless a new connection confirms (`CONFIRM=1`); `UNDO=1` removes the prefix again.
- **`set-discord-token.ps1`** sends its script as `bash -s -- no-log`, so the log records the
  command but never its input (the token).
