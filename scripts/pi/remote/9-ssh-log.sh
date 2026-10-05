#!/usr/bin/env bash
# Stage 9: a log on the Pi of every command that arrives over SSH with the PC's key, so the user can
# see afterwards exactly what Claude (and the PC's scheduled copies) ran there. The PC's key line in
# /root/.ssh/authorized_keys gets a command="..." prefix that sends each login through
# /usr/local/sbin/foundry-ssh-log; sshd_config is not touched. The wrapper writes one line per login
# to $TOOL_DATA/ssh-log/ssh-commands.log and keeps a copy of every `bash -s` script (the stage scripts),
# then runs the command unchanged. If logging fails, the command still runs (fail open).
# Commands sent as `bash -s -- no-log` (scripts/pi/set-discord-token.ps1: it carries a token) are
# logged by name only; their input is never saved. Root only (0700 folder, 0600 files), 12 weeks kept.
#
# An SSH settings change (the dangerous list): run it only after the user's OK, a dietpi-backup
# snapshot, and with the user in default permission mode. Safety net: when this run changes
# authorized_keys it first copies it to authorized_keys.before-ssh-log and arms a systemd timer that
# puts that copy back after 5 minutes. Run, then confirm from a NEW connection (no shared master), which
# cancels the timer:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/9-ssh-log.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/9-ssh-log.sh | ssh -o ControlPath=none foundry-pi 'CONFIRM=1 bash -s'
# If the new connection fails, wait 5 minutes (the timer restores the old file) or log in with the
# root password. Undo later: the same pipe with 'UNDO=1 bash -s'.

require_root
keys=/root/.ssh/authorized_keys
backup="$keys.before-ssh-log"
wrapper=/usr/local/sbin/foundry-ssh-log
log_dir="$TOOL_DATA/ssh-log"
prefix="command=\"$wrapper\" "
revert_unit=foundry-ssh-log-revert

if [ "${UNDO:-}" = 1 ]; then
  say "undo: the key lines without the log"
  [ -f "$keys" ] || die "$keys is missing"
  # Only the prefix this stage adds is removed; the log files stay (keep all data).
  tmp="$(mktemp "$keys.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  P="$prefix" awk 'index($0, ENVIRON["P"]) == 1 { $0 = substr($0, length(ENVIRON["P"]) + 1) } { print }' "$keys" >"$tmp"
  chmod 0600 "$tmp"
  mv "$tmp" "$keys"
  trap - EXIT
  ok "removed the log prefix from $keys (the logs in $log_dir are kept)"
  exit 0
fi

if [ "${CONFIRM:-}" = 1 ]; then
  say "confirm"
  grep -qF "$prefix" "$keys" || die "$keys has no log prefix: the safety timer already restored the old file, or the stage never ran; run it again, then confirm within 5 minutes"
  [ "${SSH_ORIGINAL_COMMAND:-}" != "" ] || warn "this connection did not come through the wrapper (no SSH_ORIGINAL_COMMAND): is the prefix in place?"
  if have_systemd && systemctl list-timers --all --no-legend 2>/dev/null | grep -q "$revert_unit"; then
    systemctl stop "$revert_unit.timer"
    ok "revert timer cancelled: the new key line stays"
  else
    ok "no revert timer armed (nothing to cancel)"
  fi
  tail -n 3 "$log_dir/ssh-commands.log" 2>/dev/null | sed 's/^/    log: /' || true
  exit 0
fi

say "the log folder"
install -d -m 0700 -o root -g root "$log_dir" "$log_dir/scripts"
ok "$log_dir (root only)"

say "the wrapper"
wrapper_body="#!/bin/bash
# Written by scripts/pi/remote/9-ssh-log.sh; edit it there. Runs for every SSH login with a key whose
# authorized_keys line starts with command=\"$wrapper\". Logs, then runs the command unchanged.
# Fails open: a logging error never stops the command.
log_dir=$log_dir
cmd=\"\${SSH_ORIGINAL_COMMAND-}\"
from=\"\${SSH_CLIENT%% *}\"
umask 077
# The outer braces also silence the shell's own error when the log file cannot be opened.
note() { { printf '%s %s %s\\n' \"\$(date '+%Y-%m-%d %H:%M:%S%z')\" \"\${from:-local}\" \"\$1\" >>\"\$log_dir/ssh-commands.log\"; } 2>/dev/null || true; }
case \"\$cmd\" in
'')
  note 'interactive login'
  exec \"\${SHELL:-/bin/bash}\" -l
  ;;
sftp | internal-sftp | /usr/lib/openssh/sftp-server)
  note 'sftp (file copy)'
  exec /usr/lib/openssh/sftp-server
  ;;
'bash -s')
  script=\"\$log_dir/scripts/\$(date '+%Y%m%d-%H%M%S')-\$\$.sh\"
  note \"bash -s (script saved: \$script)\"
  # tee keeps passing the input on even when it cannot write the copy.
  tee \"\$script\" 2>/dev/null | \"\${SHELL:-/bin/bash}\" -s
  exit \"\${PIPESTATUS[1]}\"
  ;;
*)
  note \"run: \$cmd\"
  exec \"\${SHELL:-/bin/bash}\" -c \"\$cmd\"
  ;;
esac"
mkdir -p "$(dirname "$wrapper")"
write_file "$wrapper" 0755 "$wrapper_body" || true
chown root:root "$wrapper"
bash -n "$wrapper" || die "the wrapper has a syntax error; nothing else changed"

say "keeping the log 12 weeks"
logrotate_conf="# Written by scripts/pi/remote/9-ssh-log.sh; edit it there.
$log_dir/ssh-commands.log {
  weekly
  rotate 12
  compress
  delaycompress
  missingok
  notifempty
  create 0600 root root
}"
write_file /etc/logrotate.d/foundry-ssh-log 0644 "$logrotate_conf" || true
prune="#!/bin/sh
# Written by scripts/pi/remote/9-ssh-log.sh; edit it there. Saved stage scripts older than 12 weeks go.
find $log_dir/scripts -maxdepth 1 -type f -name '*.sh' -mtime +84 -delete"
write_file /etc/cron.daily/foundry-ssh-log-prune 0755 "$prune" || true

say "the key lines"
[ -f "$keys" ] || die "$keys is missing"
# Key lines without options (the PC's key; a second PC's key added later is handled on the next run).
plain="$(grep -cE '^(ssh-|ecdsa-|sk-)' "$keys" || true)"
done_already="$(grep -cF "$prefix" "$keys" || true)"
if [ "$plain" = 0 ]; then
  ok "every key line already has the prefix ($done_already)"
else
  [ -f "$backup" ] || cp -a "$keys" "$backup"
  ok "copy of the old file: $backup"
  if have_systemd; then
    systemctl stop "$revert_unit.timer" 2>/dev/null || true
    systemctl reset-failed "$revert_unit.service" "$revert_unit.timer" 2>/dev/null || true
    systemd-run --quiet --unit="$revert_unit" --on-active=300 /bin/cp -a "$backup" "$keys"
    ok "safety net: $backup comes back in 5 minutes unless a new connection confirms (CONFIRM=1)"
  else
    warn "no systemd here (a test container?): no safety timer"
  fi
  tmp="$(mktemp "$keys.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  P="$prefix" awk '/^(ssh-|ecdsa-|sk-)/ { $0 = ENVIRON["P"] $0 } { print }' "$keys" >"$tmp"
  chmod 0600 "$tmp"
  mv "$tmp" "$keys"
  trap - EXIT
  ok "added the log prefix to $plain key line(s); now confirm from a NEW connection with CONFIRM=1"
fi

say "stage 9 done: log $log_dir/ssh-commands.log, scripts in $log_dir/scripts; read it with: ssh foundry-pi tail -n 50 $log_dir/ssh-commands.log"
