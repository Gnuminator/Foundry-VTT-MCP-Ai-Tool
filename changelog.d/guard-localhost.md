### Orange Pi (D-068)

- **The remote-command guard** (`.claude/hooks/guard-remote-commands.mjs`) lets commands through
  whose only ssh, scp, sftp or rsync target is this machine (`127.0.0.1`, `localhost`, `::1`), so
  stage scripts can be tested against an SSH server in the ARM64 test container; a jump host, a
  proxy, a `HostName` override or any other target keeps the guard on. It also asks now when a
  script keeps the `authorized_keys` path in a variable.
