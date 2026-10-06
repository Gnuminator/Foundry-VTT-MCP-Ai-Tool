#!/usr/bin/env bash
# Stage 6: nightly restic backups on the Pi. The dietpi-backup snapshot (01:25) restores the whole
# system after a reflash; this one is the small, fast, versioned copy of the data that matters
# (Foundry's worlds, the tool's storage, the secrets), so one world or one file can be restored
# without touching the rest. Run from the PC:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/6-backup.sh | ssh foundry-pi 'bash -s'
# The repository lives on the Pi's own disk (/var/lib/foundry-backup/restic); this PC copies it to
# E:\PiBackup\restic every day (scripts/pi/pull-restic.ps1), so the Pi's disk is not the only copy.
# Before it runs, the backup calls the storage space check from stage 10 (skipped at critical).
# The repository password is generated here, kept in a root-only file and never printed.

require_root
[ -f "$FOUNDRY_APP/main.js" ] || die "Foundry is missing: run stage 3 first"

backup_root=/var/lib/foundry-backup
repo="$backup_root/restic"
pass_file="$TOOL_ETC/restic-pi.pass"
script_dir="$TOOL_DIR/backup"
backup_script="$script_dir/foundry-backup.sh"

say "restic"
apt_install restic
ok "$(restic version </dev/null)"

say "the repository"
install -d -m 0700 -o root -g root "$backup_root"
mkdir -p "$TOOL_ETC"
if [ -s "$pass_file" ]; then
  ok "password file $pass_file already exists (kept)"
else
  # umask 077 so the file is never readable by anyone else, not even for a moment.
  (umask 077 && head -c 32 /dev/urandom | base64 | tr -d '=\n' >"$pass_file")
  ok "generated $pass_file (root only, not printed)"
fi
chown root:root "$pass_file"
chmod 0600 "$pass_file"

export RESTIC_REPOSITORY="$repo"
export RESTIC_PASSWORD_FILE="$pass_file"
if [ -f "$repo/config" ]; then
  ok "repository $repo already initialised"
else
  restic init </dev/null >/dev/null
  ok "initialised $repo"
fi

say "the backup script"
install -d -m 0755 "$script_dir"
# Quoted heredoc: nothing in it is expanded here, the script runs on its own at night.
script_body="$(
  cat <<'BACKUP_SCRIPT'
#!/usr/bin/env bash
# Nightly restic backup of the Foundry data (written by scripts/pi/remote/6-backup.sh; edit it there).
set -euo pipefail

export RESTIC_REPOSITORY=/var/lib/foundry-backup/restic
export RESTIC_PASSWORD_FILE=/etc/foundry-ai-tool/restic-pi.pass

# Space pre-check (stage 10 installs the checker; without it the backup just runs). The checker
# records the result in the status file the bot and the dashboard read. Below 20% free it warns in
# the journal and the backup still runs; at critical (under 5% free, or less free space than the
# data to back up) it exits 3 and the backup is skipped, before Foundry is stopped. Any other
# checker failure only warns: a broken check must never stop the backup.
space_check=/opt/foundry-ai-tool/space/space-check.sh
if [ -x "$space_check" ]; then
  need=""
  if du_out="$(timeout 120 du -sbx --exclude=Logs --exclude=gm-browser --exclude=recordings \
    /var/lib/foundry /var/lib/foundry-ai-tool /etc/foundry-ai-tool 2>/dev/null)"; then
    need="$(printf '%s\n' "$du_out" | awk '{ s += $1 } END { if (NR) print s + 0 }')"
  fi
  space_rc=0
  "$space_check" --job "restic backup" ${need:+--need-bytes "$need"} \
    --need-path /var/lib/foundry-backup/restic </dev/null || space_rc=$?
  if [ "$space_rc" = 3 ]; then
    echo "ERROR: backup skipped: disk space is critical (see the lines above). Free up space, then run: systemctl start foundry-backup.service" >&2
    exit 1
  elif [ "$space_rc" != 0 ]; then
    echo "WARNING: the space check failed (exit $space_rc); backing up anyway" >&2
  fi
else
  echo "space check not installed (stage 10): backing up without it"
fi

# Foundry keeps its worlds in LevelDB, which must not change while it is copied, so Foundry is
# stopped for the backup. The trap starts it again whatever happens, including a failed backup.
foundry_stopped=0
start_foundry() {
  if [ "$foundry_stopped" = 1 ]; then
    foundry_stopped=0
    systemctl start foundry.service </dev/null || echo "WARNING: could not start foundry.service" >&2
    echo "foundry.service started again"
  fi
}
trap start_foundry EXIT

if [ -d /run/systemd/system ] && systemctl is-active --quiet foundry.service; then
  echo "stopping foundry.service for the backup"
  systemctl stop foundry.service </dev/null
  foundry_stopped=1
else
  echo "foundry.service is not running under systemd: backing up as it is"
fi

# Left out on purpose: Foundry's logs, the Assistant GM's Chromium profile (rebuilt by logging in)
# and the recordings (this PC pulls them separately and the Pi deletes them after 7 days).
restic backup --tag nightly \
  --exclude /var/lib/foundry/Logs \
  --exclude /var/lib/foundry-ai-tool/gm-browser \
  --exclude /var/lib/foundry-ai-tool/recordings \
  /var/lib/foundry /var/lib/foundry-ai-tool /etc/foundry-ai-tool </dev/null

start_foundry

# Foundry is back up before the slow clean-up starts.
restic forget --keep-daily 7 --prune </dev/null
echo "backup done"
BACKUP_SCRIPT
)"
write_file "$backup_script" 0755 "$script_body" || true
chown root:root "$backup_script"
chmod 0755 "$backup_script"

say "the timer"
service_unit="[Unit]
Description=Foundry nightly restic backup (stops Foundry for a few minutes)
After=network-online.target

[Service]
Type=oneshot
ExecStart=$backup_script
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=3h"

timer_unit="[Unit]
Description=Foundry nightly restic backup at 04:30 (dietpi-backup runs at 01:25, the PC copies at 12:30)

[Timer]
OnCalendar=*-*-* 04:30
# No catch-up run after a boot: a missed night must never stop Foundry during a game.
Persistent=false

[Install]
WantedBy=timers.target"

write_file /etc/systemd/system/foundry-backup.service 0644 "$service_unit" || true
write_file /etc/systemd/system/foundry-backup.timer 0644 "$timer_unit" || true
# The timer is enabled, not the service: the timer starts the service.
enable_unit foundry-backup.timer

if have_systemd; then
  say "one backup now (Foundry stops for a minute or two)"
  systemctl start foundry-backup.service </dev/null ||
    die "the backup failed; see: journalctl -u foundry-backup -n 50"
  ok "first backup done"
  systemctl list-timers foundry-backup.timer --no-pager </dev/null || true
else
  warn "no systemd here (a test container?): run $backup_script by hand to test it"
fi

say "snapshots"
restic snapshots --compact </dev/null || true

say "stage 6 done: restic repository $repo on the Pi, nightly at 04:30; this PC copies it once pull-restic.ps1 runs"
