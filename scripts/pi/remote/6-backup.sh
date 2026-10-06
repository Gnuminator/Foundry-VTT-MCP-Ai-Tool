#!/usr/bin/env bash
# Stage 6: nightly restic backups on the Pi. The dietpi-backup snapshot (01:25) restores the whole
# system after a reflash; this one is the small, fast, versioned copy of the data that matters
# (Foundry's worlds, the tool's storage, the secrets), so one world or one file can be restored
# without touching the rest. Run from the PC:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/6-backup.sh | ssh foundry-pi 'bash -s'
# The repository lives on the Pi's own disk (/var/lib/foundry-backup/restic); this PC copies it to
# E:\PiBackup\restic every day (scripts/pi/pull-restic.ps1), so the Pi's disk is not the only copy.
# Before it runs, the backup calls the storage space check from stage 10 (skipped at critical).
# The same stage installs record-pull.sh: the PC's pull scripts call it after each successful copy,
# and the Discord bot DMs the owner when no copy has arrived for 3 days (PB-06).
# The repository password is generated here, kept in a root-only file and never printed.

require_root
[ -f "$FOUNDRY_APP/main.js" ] || die "Foundry is missing: run stage 3 first"

backup_root=/var/lib/foundry-backup
repo="$backup_root/restic"
pass_file="$TOOL_ETC/restic-pi.pass"
script_dir="$TOOL_DIR/backup"
backup_script="$script_dir/foundry-backup.sh"
record_script="$script_dir/record-pull.sh"
# Root-owned and outside /var/lib/foundry-ai-tool (which the foundry user owns), so a compromised foundry
# process cannot swap the folder for a symlink and make root write somewhere else.
pulls_dir=/var/lib/foundry-backup-pulls

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
# the journal and the backup still runs; at critical (under 5% free on a disk the backup uses) it
# exits 3 and the backup is skipped, before Foundry is stopped. There is no "enough room for the
# data" test on purpose: restic stores only what changed and its repository shares the disk with
# the data it copies. A checker that fails, hangs (60 s limit) or exits with anything other than 3
# only warns: a broken check must never stop the backup.
space_check=/opt/foundry-ai-tool/space/space-check.sh
if [ -x "$space_check" ]; then
  space_rc=0
  timeout 60 "$space_check" --job "restic backup" </dev/null || space_rc=$?
  if [ "$space_rc" = 3 ]; then
    echo "ERROR: backup skipped: disk space is critical (see the lines above). Free up space, then run: systemctl start foundry-backup.service" >&2
    exit 1
  elif [ "$space_rc" = 124 ]; then
    echo "WARNING: the space check did not finish within 60 seconds; backing up anyway" >&2
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

say "the record of the PC's copies (PB-06)"
# After each successful run, the PC's pull scripts call `record-pull.sh restic|snapshot` over SSH. It
# writes the Pi's own clock into $pulls_dir/<kind>.json, and the Discord bot (it runs here, as the
# foundry user) DMs the owner when a kind of copy (restic or snapshot) is older than 3 days. The folder is
# root:root 0755 (the bot only reads it, the helper writes it as root); the files hold no secrets.
# `install -d` would follow a symlink and re-own its target, so refuse a symlink first.
if [ -L "$pulls_dir" ]; then
  die "$pulls_dir is a symbolic link: remove it by hand (after looking at where it points), then run stage 6 again"
fi
install -d -m 0755 -o root -g root "$pulls_dir"
ok "$pulls_dir (root-owned; the bot only reads it)"
record_body="$(
  cat <<'RECORD_PULL'
#!/usr/bin/env bash
# Records that the PC copied the Pi's backups just now (written by scripts/pi/remote/6-backup.sh; edit it there).
#   record-pull.sh restic      pull-restic.ps1 finished a copy
#   record-pull.sh snapshot    pull-snapshot.ps1 finished a copy
# Writes <folder>/<kind>.json atomically: {"version":1,"kind":"restic","pulledAt":"2026-10-06T10:31:02Z"}.
# The only argument that works is restic or snapshot; nothing else is read or run. The folder is
# root-owned and outside the foundry user's tree; a symbolic link as the folder or as the target file
# is refused (exit 70). Environment (tests): FOUNDRY_AI_BACKUP_PULLS (the folder).
set -euo pipefail
kind="${1:-}"
case "$kind" in
restic | snapshot) ;;
*)
  echo "usage: record-pull.sh restic|snapshot" >&2
  exit 64
  ;;
esac
dir="${FOUNDRY_AI_BACKUP_PULLS:-/var/lib/foundry-backup-pulls}"
if [ -L "$dir" ]; then
  echo "refusing: $dir is a symbolic link" >&2
  exit 70
fi
mkdir -p "$dir"
if [ -L "$dir/$kind.json" ]; then
  echo "refusing: $dir/$kind.json is a symbolic link" >&2
  exit 70
fi
tmp="$(mktemp "$dir/.$kind.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
printf '{"version":1,"kind":"%s","pulledAt":"%s"}\n' "$kind" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$tmp"
chmod 0644 "$tmp"
sync "$tmp" 2>/dev/null || true # best effort: flush the new file before it replaces the old one
# -T: the target is always a file, so a directory at that name is an error, never moved into
mv -fT "$tmp" "$dir/$kind.json"
trap - EXIT
echo "recorded: $kind copied to the PC"
RECORD_PULL
)"
write_file "$record_script" 0755 "$record_body" || true
chown root:root "$record_script"
chmod 0755 "$record_script"

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

say "stage 6 done: restic repository $repo on the Pi, nightly at 04:30; this PC copies it once pull-restic.ps1 runs; the PC's copies are recorded in $pulls_dir by $record_script"
