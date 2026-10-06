#!/usr/bin/env bash
# Stage 10: a storage space check on the Pi. The user's rule (2026-10-06): every backup, snapshot and
# sync checks its source and its destination for at least 20% free space; below 20% the job still
# runs but warns, and it stops only when space is critical (under 5% free, or less free space than
# the job needs when that is known). This stage installs:
#   - the checker $TOOL_DIR/space/space-check.sh, which writes the status file
#     $TOOL_DATA/space/status.json (one entry per filesystem; the contract is in the checker's header)
#     and logs a WARNING line to the journal when a disk is low or critical;
#   - a systemd timer that runs it every hour (foundry-space-check.timer, Persistent=true).
# The nightly restic backup (stage 6) calls the same checker first (see 6-backup.sh): run stage 6
# again after this one is in place if it was installed earlier. dietpi-backup's own job is DietPi's
# and is not touched: the hourly check only looks at the disk its snapshots sit on.
# Run from the PC:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/10-space-check.sh | ssh foundry-pi 'bash -s'
# Undo (stops and removes the timer, the checker and the status file; the folders stay):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/10-space-check.sh | ssh foundry-pi 'UNDO=1 bash -s'
# The status file is read by the Discord bot (a DM), the dashboard (a GM-only banner) and this PC's
# pull scripts (scripts/pi/space-check.ps1, over read-only SSH).

require_root

checker_dir="$TOOL_DIR/space"
checker="$checker_dir/space-check.sh"
space_dir="$TOOL_DATA/space"
status_file="$space_dir/status.json"
service_file=/etc/systemd/system/foundry-space-check.service
timer_file=/etc/systemd/system/foundry-space-check.timer

if [ "${UNDO:-}" = 1 ]; then
  say "undo: removing the hourly space check"
  if have_systemd; then
    systemctl disable --now foundry-space-check.timer >/dev/null 2>&1 || true
    systemctl stop foundry-space-check.service >/dev/null 2>&1 || true
  fi
  # Single files only. The nightly backup skips its pre-check when the checker is missing.
  rm -f "$service_file" "$timer_file" "$checker" "$status_file"
  have_systemd && systemctl daemon-reload
  ok "removed the timer, the checker and $status_file (the folders and the backup script stay)"
  exit 0
fi

id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"

say "the folders"
install -d -m 0755 "$checker_dir"
install -d -m 0755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$space_dir"
ok "$checker_dir (the checker), $space_dir (the status file, readable by everyone)"

say "the checker"
# Quoted heredoc: nothing in it is expanded here, the checker runs on its own every hour.
checker_body="$(
  cat <<'SPACE_CHECK'
#!/usr/bin/env bash
# Storage space check (written by scripts/pi/remote/10-space-check.sh; edit it there).
#
#   space-check.sh                     write the status file (the hourly timer)
#   space-check.sh --job "restic backup" [--need-bytes N] [--need-path P]
#                                      a job's pre-check: also record lastJob; exit 3 when space is
#                                      critical for that job (the job must not run), else 0
#   space-check.sh --print             print the JSON instead of writing the file
#
# Levels per filesystem: "low" below 20% free, "critical" below 5% free or (with --need-bytes) less
# free space than the job needs on --need-path's filesystem; "ok" otherwise. The overall level is the
# worst one. A job is blocked only by disks that list it (a job name matches the start of a job label
# such as "restic backup (source)"): a full snapshot disk never stops the restic backup.
# The status file is written atomically (a temp file in the same folder, then mv). No secrets in it.
# Environment (tests): FOUNDRY_AI_SPACE_STATUS (the file), FOUNDRY_AI_SPACE_DF (df program),
# FOUNDRY_AI_SPACE_ENTRIES (lines "path|job;job" replacing the default list), FOUNDRY_AI_SPACE_HOST.
set -euo pipefail
export LC_ALL=C

STATUS_FILE="${FOUNDRY_AI_SPACE_STATUS:-/var/lib/foundry-ai-tool/space/status.json}"
DF="${FOUNDRY_AI_SPACE_DF:-df}"
THRESHOLD=20
CRITICAL=5
HOST="${FOUNDRY_AI_SPACE_HOST:-$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo unknown)}"

# Paths on the Pi and the jobs that use them. Paths that do not exist are skipped.
default_entries='/var/lib/foundry|restic backup (source)
/var/lib/foundry-ai-tool|restic backup (source);Syncthing vault (source);recordings
/etc/foundry-ai-tool|restic backup (source)
/var/lib/foundry-backup/restic|restic backup (destination)
/mnt/dietpi-backup|snapshot pull (source);system snapshots (destination)'
entries="${FOUNDRY_AI_SPACE_ENTRIES:-$default_entries}"

job=""
need_bytes=""
need_path=""
print_only=0
while [ $# -gt 0 ]; do
  case "$1" in
  --job)
    job="${2:?--job needs a name}"
    shift 2
    ;;
  --need-bytes)
    need_bytes="${2:?--need-bytes needs a number}"
    shift 2
    ;;
  --need-path)
    need_path="${2:?--need-path needs a path}"
    shift 2
    ;;
  --print)
    print_only=1
    shift
    ;;
  *)
    echo "space-check: unknown option $1" >&2
    exit 64
    ;;
  esac
done
case "$need_bytes" in
*[!0-9]*)
  echo "space-check: --need-bytes must be a whole number of bytes" >&2
  exit 64
  ;;
esac

# Journal priorities (systemd sets JOURNAL_STREAM): <4> warning, <2> critical.
prio() { if [ -n "${JOURNAL_STREAM:-}" ]; then printf '<%s>' "$1"; fi; }
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}
# level TOTAL FREE NEED
level_of() {
  awk -v t="$1" -v f="$2" -v n="${3:-0}" -v th="$THRESHOLD" -v cr="$CRITICAL" \
    'BEGIN { p = f * 100 / t; if (p < cr || (n > 0 && f < n)) print "critical"; else if (p < th) print "low"; else print "ok" }'
}
percent_of() { awk -v t="$1" -v f="$2" 'BEGIN { printf "%.1f", f * 100 / t }'; }
gb_of() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1073741824 }'; }
worse() { # the worse of two levels
  case "$1$2" in
  *critical*) echo critical ;;
  *low*) echo low ;;
  *) echo ok ;;
  esac
}
# Quoted, comma-separated list from lines on stdin, duplicates dropped.
json_list() {
  awk 'NF && !seen[$0]++ { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); printf "%s\"%s\"", (n++ ? ", " : ""), $0 }'
}

declare -A m_total m_free m_paths m_jobs
order=()
need_mount=""
add_path() { # path joblist (; separated); returns the mount through $mount
  local path="$1" joblist="$2" line total avail
  mount=""
  [ -e "$path" ] || return 0
  line="$("$DF" -P -B1 -- "$path" 2>/dev/null | tail -n 1)" || return 0
  [ -n "$line" ] || return 0
  # Filesystem 1-blocks Used Available Capacity Mounted-on
  read -r _ total _ avail _ mount <<<"$line"
  case "$total$avail" in *[!0-9]* | '') mount="" ; return 0 ;; esac
  [ "$total" -gt 0 ] || { mount=""; return 0; }
  if [ -z "${m_total[$mount]+x}" ]; then
    order+=("$mount")
    m_total[$mount]="$total"
    m_free[$mount]="$avail"
    m_paths[$mount]="$path"
    m_jobs[$mount]="${joblist//;/$'\n'}"
  else
    m_paths[$mount]+=$'\n'"$path"
    m_jobs[$mount]+=$'\n'"${joblist//;/$'\n'}"
  fi
}

while IFS='|' read -r path joblist; do
  [ -n "$path" ] || continue
  add_path "$path" "$joblist"
done <<<"$entries"

if [ -n "$need_path" ]; then
  p="$need_path"
  while [ ! -e "$p" ] && [ "$p" != / ]; do p="$(dirname "$p")"; done
  add_path "$p" "${job:-job} (destination)"
  need_mount="$mount"
fi

overall=ok
job_level=ok
disks_json=""
for mount in "${order[@]}"; do
  total="${m_total[$mount]}"
  free="${m_free[$mount]}"
  need=0
  if [ "$mount" = "$need_mount" ] && [ -n "$need_bytes" ]; then need="$need_bytes"; fi
  level="$(level_of "$total" "$free" "$need")"
  pct="$(percent_of "$total" "$free")"
  overall="$(worse "$overall" "$level")"
  if [ -n "$job" ] && [[ $'\n'"${m_jobs[$mount]}" == *$'\n'"$job ("* ]]; then
    job_level="$(worse "$job_level" "$level")"
  fi
  [ -z "$disks_json" ] || disks_json+=$',\n'
  disks_json+="    {
      \"mount\": \"$(json_escape "$mount")\",
      \"paths\": [$(printf '%s\n' "${m_paths[$mount]}" | json_list)],
      \"jobs\": [$(printf '%s\n' "${m_jobs[$mount]}" | json_list)],
      \"totalBytes\": $total,
      \"freeBytes\": $free,
      \"freePercent\": $pct,
      \"level\": \"$level\"
    }"
  if [ "$level" != ok ]; then
    uses="$(printf '%s\n' "${m_jobs[$mount]}" | awk 'NF && !s[$0]++ { printf "%s%s", (n++ ? ", " : ""), $0 }')"
    if [ "$level" = critical ]; then tag=CRITICAL; sev=2; else tag=WARNING; sev=4; fi
    printf '%s%s: disk %s has %s%% free (%s GB of %s GB); used by: %s\n' "$(prio "$sev")" "$tag" "$mount" "$pct" \
      "$(gb_of "$free")" "$(gb_of "$total")" "$uses" >&2
    if [ "$level" = critical ] && [ "$need" -gt "$free" ]; then
      printf '%s%s: %s needs about %s GB on %s\n' "$(prio "$sev")" "$tag" "${job:-the job}" "$(gb_of "$need")" "$mount" >&2
    fi
  fi
done

now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
last_job=""
if [ -n "$job" ]; then
  ran=true
  [ "$job_level" != critical ] || ran=false
  last_job="{ \"name\": \"$(json_escape "$job")\", \"at\": \"$now\", \"level\": \"$job_level\", \"ran\": $ran }"
elif [ -f "$STATUS_FILE" ]; then
  # The hourly run keeps what the last job recorded (the line starts with two spaces and "lastJob").
  last_job="$(sed -n 's/^  "lastJob": \({.*}\)$/\1/p' "$STATUS_FILE" 2>/dev/null | tail -n 1 || true)"
fi

json="{
  \"version\": 1,
  \"checkedAt\": \"$now\",
  \"host\": \"$(json_escape "$HOST")\",
  \"thresholdPercent\": $THRESHOLD,
  \"criticalPercent\": $CRITICAL,
  \"level\": \"$overall\",
  \"disks\": ["
if [ -n "$disks_json" ]; then json+="
$disks_json
  ]"; else json+="]"; fi
if [ -n "$last_job" ]; then json+=",
  \"lastJob\": $last_job"; fi
json+="
}"

if [ "$print_only" = 1 ]; then
  printf '%s\n' "$json"
else
  # A full disk can refuse even this small file: say so and carry on with the exit status below.
  if ! (
    dir="$(dirname "$STATUS_FILE")"
    mkdir -p "$dir"
    tmp="$(mktemp "$dir/.status.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    printf '%s\n' "$json" >"$tmp"
    chmod 0644 "$tmp"
    mv "$tmp" "$STATUS_FILE"
    trap - EXIT
  ) 2>/dev/null; then
    echo "$(prio 4)WARNING: could not write $STATUS_FILE" >&2
  fi
fi

if [ -n "$job" ] && [ "$job_level" = critical ]; then exit 3; fi
exit 0
SPACE_CHECK
)"
write_file "$checker" 0755 "$checker_body" || true
chown root:root "$checker"
chmod 0755 "$checker"
bash -n "$checker" || die "the checker has a syntax error; nothing else changed"

say "the hourly timer"
service_unit="[Unit]
Description=Foundry AI Tool storage space check (writes $status_file)

[Service]
Type=oneshot
ExecStart=$checker
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=2min"

timer_unit="[Unit]
Description=Foundry AI Tool storage space check, every hour

[Timer]
OnCalendar=hourly
OnBootSec=3min
Persistent=true

[Install]
WantedBy=timers.target"

write_file "$service_file" 0644 "$service_unit" || true
write_file "$timer_file" 0644 "$timer_unit" || true
# The timer is enabled, not the service: the timer starts the service.
enable_unit foundry-space-check.timer

say "one check now"
if have_systemd; then
  systemctl start foundry-space-check.service </dev/null ||
    die "the check failed; see: journalctl -u foundry-space-check -n 50"
  systemctl list-timers foundry-space-check.timer --no-pager </dev/null || true
else
  "$checker" </dev/null || true
fi
[ -s "$status_file" ] || die "no status file was written to $status_file"
ok "status file $status_file:"
sed 's/^/    /' "$status_file"

say "stage 10 done: hourly check, status in $status_file; the nightly backup (stage 6) checks first once stage 6 has been run again"
