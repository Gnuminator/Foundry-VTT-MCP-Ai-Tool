#!/usr/bin/env bash
# Stage 16: the Pi reports its own health to the PM board once an hour (backlog board-pi-status). The PC is not
# always on, so the Pi does it: a systemd timer runs a small read-only status script that POSTs one JSON object to
# the board over Cloudflare Access with a service token. Run from the PC:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/16-board-status.sh | ssh foundry-pi 'bash -s'
# Before it runs: the user creates the token file $TOOL_ETC/board-status.conf (root:root, mode 0600) with exactly
# two lines (the values come from the Cloudflare Zero Trust service token the user made for the board):
#   header = "CF-Access-Client-Id: <id>.access"
#   header = "CF-Access-Client-Secret: <secret>"
# The stage refuses without a file like that and never prints a line of it. The status script reads the Pi, changes
# nothing, and sends: up, uptime, disk free, the last nightly backup (result and time), Foundry up or down and the
# Foundry and dnd5e versions. No log lines, no secrets, no host name but the constant "foundry-pi".

require_root
require_recent_snapshot

conf="$TOOL_ETC/board-status.conf"
status_dir="$TOOL_DIR/status"
status_script="$status_dir/board-status.sh"

say "the token file"
# Checked before anything is written. A symbolic link is refused (a link could point at a file anyone can read); only
# `header = "CF-Access-Client-Id|Secret: ..."` lines and comments are allowed, so the file cannot add a URL, an output
# file or another curl option. Errors name a line number, never its content.
if [ -L "$conf" ] || [ ! -f "$conf" ]; then
  die "$conf is missing. Create it (root, mode 0600) with the two header lines from the stage 16 header, then run this again"
fi
[ "$(stat -c '%u %a' "$conf")" = "0 600" ] || die "$conf must be owned by root with mode 0600 (chown root:root, chmod 600)"
bad_line="$(grep -nvE '^(header = "CF-Access-Client-(Id|Secret): [^" ]+"|#.*|)$' "$conf" | head -n 1 | cut -d: -f1 || true)"
[ -z "$bad_line" ] || die "$conf line $bad_line is not a header line or a comment (content not shown)"
for h in Id Secret; do
  [ "$(grep -cE "^header = \"CF-Access-Client-$h: [^\" ]+\"\$" "$conf" || true)" = 1 ] ||
    die "$conf must hold exactly one CF-Access-Client-$h header line"
done
ok "$conf is present, root-only, two header lines (not printed)"

[ -x "$NODE_DIR/bin/node" ] || die "Node is missing at $NODE_DIR: run stage 2 first"
command -v curl >/dev/null 2>&1 || die "curl is missing"
command -v restic >/dev/null 2>&1 || die "restic is missing: run stage 6 first"

say "the status script"
install -d -m 0755 -o root -g root "$status_dir"
# Quoted heredoc: nothing in it is expanded here, the script runs on its own every hour.
script_body="$(
  cat <<'STATUS_SCRIPT'
#!/usr/bin/env bash
# Hourly Pi status report to the PM board (written by scripts/pi/remote/16-board-status.sh; edit it there).
# Reads the Pi, changes nothing, POSTs one JSON object. Exit 0 only when the board answered 2xx.
# Environment, for tests only: FOUNDRY_STATUS_TEST=1 (allows http, a non-root owner, and --dry-run),
# FOUNDRY_STATUS_ETC, FOUNDRY_STATUS_URL, FOUNDRY_STATUS_NODE, FOUNDRY_STATUS_DF_PATH, FOUNDRY_STATUS_API,
# FOUNDRY_STATUS_BACKUP_UNIT. With --dry-run (tests only) the JSON is printed and nothing is sent.
set -euo pipefail
umask 077

test_mode="${FOUNDRY_STATUS_TEST:-0}"
etc="${FOUNDRY_STATUS_ETC:-/etc/foundry-ai-tool}"
conf="$etc/board-status.conf"
url="${FOUNDRY_STATUS_URL:-https://board.spennerit.com/api/pi-status}"
node="${FOUNDRY_STATUS_NODE:-/opt/node24/bin/node}"
df_path="${FOUNDRY_STATUS_DF_PATH:-/var/lib/foundry}"
api="${FOUNDRY_STATUS_API:-http://127.0.0.1:30000/api/status}"
backup_unit="${FOUNDRY_STATUS_BACKUP_UNIT:-foundry-backup.service}"
dry=0
[ "${1:-}" = "--dry-run" ] && [ "$test_mode" = 1 ] && dry=1

if [ "$dry" = 0 ]; then
  if [ -L "$conf" ] || [ ! -f "$conf" ]; then
    echo "board-status: the token file is missing" >&2
    exit 78
  fi
  owner_ok=0
  if [ "$test_mode" = 1 ]; then owner_ok=1; fi
  if [ "$(stat -c '%u %a' "$conf")" = "0 600" ]; then owner_ok=1; fi
  if [ "$owner_ok" != 1 ]; then
    echo "board-status: the token file must be root-owned with mode 0600" >&2
    exit 78
  fi
fi

# Disk: the one holding Foundry's data (falls back to /).
[ -d "$df_path" ] || df_path=/
disk_line="$(df -Pk "$df_path" 2>/dev/null | awk 'NR==2 {print $2, $4}' || true)"
disk_total_kb="${disk_line%% *}"
disk_free_kb="${disk_line##* }"
uptime_s="$(cut -d. -f1 /proc/uptime 2>/dev/null || true)"

# Last nightly backup: the systemd result of the last run, and the time of the newest restic snapshot (read-only:
# --no-lock, --no-cache). Either may be unknown; that is reported as null, never as an error.
backup_result="$(systemctl show -p Result --value "$backup_unit" 2>/dev/null || true)"
backup_at=""
if command -v restic >/dev/null 2>&1; then
  backup_at="$(
    RESTIC_REPOSITORY=/var/lib/foundry-backup/restic RESTIC_PASSWORD_FILE=/etc/foundry-ai-tool/restic-pi.pass \
      timeout 60 restic snapshots --no-lock --no-cache --latest 1 --json </dev/null 2>/dev/null |
      "$node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).map(x=>Date.parse(x.time)).filter(Number.isFinite);if(t.length)process.stdout.write(new Date(Math.max(...t)).toISOString())}catch{}})' 2>/dev/null
  )" || backup_at=""
fi

# Foundry: /api/status answers on the setup screen too.
api_json="$(curl -fs --max-time 5 "$api" 2>/dev/null || true)"

payload="$(
  DISK_TOTAL_KB="$disk_total_kb" DISK_FREE_KB="$disk_free_kb" UPTIME_S="$uptime_s" BACKUP_RESULT="$backup_result" \
    BACKUP_AT="$backup_at" API_JSON="$api_json" "$node" -e '
const e = process.env;
const num = v => (/^\d+$/.test(v || "") ? Number(v) : null);
const word = (v, max) => (typeof v === "string" && /^[A-Za-z0-9._-]+$/.test(v) && v.length <= max ? v : null);
let api = null;
try { api = JSON.parse(e.API_JSON || ""); } catch {}
if (api === null || typeof api !== "object") api = null;
const total = num(e.DISK_TOTAL_KB), free = num(e.DISK_FREE_KB);
const gb = kb => (kb === null ? null : Math.round((kb / 1024 / 1024) * 10) / 10);
const at = Date.parse(e.BACKUP_AT || "");
process.stdout.write(JSON.stringify({
  v: 1,
  host: "foundry-pi",
  sentAt: new Date().toISOString(),
  uptimeSeconds: num(e.UPTIME_S),
  disk: {
    freeGb: gb(free),
    totalGb: gb(total),
    freePercent: total && free !== null ? Math.round((free / total) * 1000) / 10 : null,
  },
  backup: {
    result: word(e.BACKUP_RESULT, 24),
    at: Number.isFinite(at) ? new Date(at).toISOString() : null,
  },
  foundry: {
    up: api !== null,
    version: api ? word(String(api.version ?? ""), 24) : null,
    dnd5e: api && api.system === "dnd5e" ? word(String(api.systemVersion ?? ""), 24) : null,
  },
}));
'
)"
[ -n "$payload" ] || {
  echo "board-status: could not build the report" >&2
  exit 70
}

if [ "$dry" = 1 ]; then
  printf '%s\n' "$payload"
  exit 0
fi

proto='=https'
[ "$test_mode" = 1 ] && proto='=http,https'
# -K reads the two Access headers from the root-only file, so they never appear in the process list.
code="$(printf '%s' "$payload" | curl -sS -o /dev/null -w '%{http_code}' --proto "$proto" --max-time 20 \
  -K "$conf" -H 'Content-Type: application/json' --data-binary @- "$url" 2>/dev/null)" || {
  echo "board-status: could not reach the board" >&2
  exit 69
}
case "$code" in
2??) echo "board-status: sent (HTTP $code)" ;;
*)
  echo "board-status: the board answered HTTP $code" >&2
  exit 69
  ;;
esac
STATUS_SCRIPT
)"
write_file "$status_script" 0755 "$script_body" || true
chown root:root "$status_script"
chmod 0755 "$status_script"

say "the timer"
service_unit="[Unit]
Description=Foundry AI Tool: report the Pi's health to the PM board (read-only)
After=network-online.target

[Service]
Type=oneshot
ExecStart=$status_script
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
PrivateTmp=true
TimeoutStartSec=120"

timer_unit="[Unit]
Description=Foundry AI Tool: Pi health report to the PM board, hourly at minute 07

[Timer]
OnCalendar=*-*-* *:07:00
RandomizedDelaySec=120
# A report soon after a boot, and one after a missed hour: both only read the Pi and send one POST.
OnBootSec=5min
Persistent=true

[Install]
WantedBy=timers.target"

write_file /etc/systemd/system/foundry-board-status.service 0644 "$service_unit" || true
write_file /etc/systemd/system/foundry-board-status.timer 0644 "$timer_unit" || true
# The timer is enabled, not the service: the timer starts the service.
enable_unit foundry-board-status.timer

if have_systemd; then
  say "one report now"
  "$status_script" </dev/null || die "the first report failed (see the line above); check the token and that the board endpoint is deployed"
  ok "first report sent"
  systemctl list-timers foundry-board-status.timer --no-pager </dev/null || true
else
  warn "no systemd here (a test container?): run $status_script by hand to test it"
fi

say "stage 16 done: $status_script reports to the board hourly (minute 07) from foundry-board-status.timer"
