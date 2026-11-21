#!/usr/bin/env bash
# Stage 35: the "Who uses what" reading sent by the Pi to the PM board (backlog who-uses-what-pi-job, D-146; moved to the board
# endpoint by stage35-board-endpoint, D-149). A systemd timer asks the Pi dashboard for the GM-only usage report every 4 hours and
# on Sunday 23:00 and POSTs it to the board (board.spennerit.com/api/who-uses-what) the way stage 16 posts the Pi's health: over
# Cloudflare Access with the service token in $TOOL_ETC/board-status.conf. The Pi is always on, so the reading is fresh without
# the user's PC. The report holds names, versions, tool names and counts only; never typed text.
#
# There is no key to the vault repo on the Pi (D-149: the internet-facing foundry user holds no write access to the vault). The
# job needs no new secret: it reuses the token file stage 16 made, so run stage 16 first. The board stores the reading itself.
#
# What it changes, nothing else:
#   1. installs scripts/who-uses-what.mjs and scripts/pi/who-uses-what-push.sh into $TOOL_DIR/who-uses-what (copy both to /root
#      first, see below; Node's built-ins only, so no npm install and no dependency on the release build);
#   2. writes the unit foundry-ai-tool-who-uses-what.service (oneshot, runs as root because board-status.conf is root-only 0600,
#      sandboxed: no writable path, no new privileges; reads dashboard-access.env for the GM token) and the timer, then takes ONE
#      reading now. The timer is enabled only when the board accepted that reading;
#   3. removes what the first version of this stage left (the deploy key, the known_hosts and the sparse vault clone in
#      /var/lib/foundry-ai-tool-who-uses-what). The user also deletes the deploy key on GitHub (repo Gnuminator/obsidian-vault,
#      Settings, Deploy keys). The dietpi-backup exclude line for that folder stays (harmless). That exclude line also means no
#      snapshot holds the old key: it cannot be restored, only replaced by a new deploy key.
#   4. turns the first version's timer off before anything else is changed, so a run that fails at the reading (for example the
#      board endpoint is not deployed yet) leaves the timer off, not enabled and failing every 4 hours.
# It restarts nothing: the bridge, the dashboard, Foundry and the recorder are not touched, so it needs no quiet check.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    read the report and check the token file (no post); exit 1 when one fails
#   UNDO=1     stop and remove the timer, the service and the installed files
# A real run (and UNDO) needs a dietpi-backup snapshot from today and the user's OK. These lines are bash:
#   scp scripts/who-uses-what.mjs scripts/pi/who-uses-what-push.sh foundry-pi:/root/   (from a clean checkout of main at the merge commit)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/35-who-uses-what.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/35-who-uses-what.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/35-who-uses-what.sh | ssh foundry-pi 'CHECK=1 bash -s'
# Tests only: SRC_DIR, UNIT_DIR (TOOL_ETC, TOOL_DIR, TOOL_DATA and NODE_DIR are set by lib.sh, so they are not overrides).

dry="${DRY_RUN:-0}"
check="${CHECK:-0}"
undo="${UNDO:-0}"
src_dir="${SRC_DIR:-/root}"
unit_dir="${UNIT_DIR:-/etc/systemd/system}"
unit_name=foundry-ai-tool-who-uses-what
service_file="$unit_dir/$unit_name.service"
timer_file="$unit_dir/$unit_name.timer"
dest="$TOOL_DIR/who-uses-what"
legacy_state=/var/lib/foundry-ai-tool-who-uses-what
access_env="$TOOL_ETC/dashboard-access.env"
board_conf="$TOOL_ETC/board-status.conf"
files="who-uses-what.mjs who-uses-what-push.sh"

require_root
modes=0
for m in "$dry" "$check" "$undo"; do [ "$m" = 1 ] && modes=$((modes + 1)); done
[ "$modes" -le 1 ] || die "use one of DRY_RUN=1, CHECK=1 and UNDO=1, not several"
if [ "$dry" != 1 ] && [ "$check" != 1 ]; then require_recent_snapshot; fi

want_service="[Unit]
Description=Foundry AI Tool: send the Who uses what reading to the PM board
After=network-online.target foundry-ai-tool-dashboard.service
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-$access_env
Environment=WUW_NODE=$NODE_DIR/bin/node
Environment=WUW_SCRIPT=$dest/who-uses-what.mjs
ExecStart=/usr/bin/env bash $dest/who-uses-what-push.sh
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
CapabilityBoundingSet=
PrivateDevices=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
TimeoutStartSec=300"

want_timer="[Unit]
Description=Foundry AI Tool: Who uses what reading, every 4 hours and Sunday 23:00

[Timer]
OnCalendar=*-*-* 00/4:25:00
OnCalendar=Sun *-*-* 23:00:00
RandomizedDelaySec=120
# No catch-up run for a missed time: the next one is at most 4 hours away, and a run at boot would fire before the network is ready.
Persistent=false

[Install]
WantedBy=timers.target"

# The token file stage 16 made: the same checks as stage 16, so a bad file stops the stage before anything is written.
check_board_conf() {
  [ ! -L "$board_conf" ] && [ -f "$board_conf" ] || die "$board_conf is missing: run stage 16 first (the reading is sent with the same Access token)"
  [ "$(stat -c '%u %a' "$board_conf")" = "0 600" ] || die "$board_conf must be owned by root with mode 0600"
  local bad
  bad="$(LC_ALL=C grep -a -nvE '^(header = "CF-Access-Client-(Id|Secret): [^" ]+"|#.*|)$' "$board_conf" | head -n 1 | cut -d: -f1 || true)"
  [ -z "$bad" ] || die "$board_conf line $bad is not a header line or a comment (content not shown)"
}

if [ "$check" = 1 ]; then
  say "check: the report and the board token file (nothing posted)"
  [ -f "$dest/who-uses-what-push.sh" ] || die "the job is not installed ($dest): run this stage without CHECK first"
  [ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
  check_board_conf
  say "installed files (compare with the repo at the merge commit)"
  (cd "$dest" && sha256sum $files) | sed 's/^/    /' || true
  # The job reads the token from the env file itself, so it never sits on a command line.
  rc=0
  out="$(WUW_MODE=check WUW_NODE="$NODE_DIR/bin/node" WUW_SCRIPT="$dest/who-uses-what.mjs" WUW_ENV_FILE="$access_env" \
    bash "$dest/who-uses-what-push.sh" 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/    /' || true
  if have_systemd; then
    systemctl is-enabled --quiet "$unit_name.timer" && ok "$unit_name.timer is enabled" || warn "$unit_name.timer is not enabled yet (run the stage once the board endpoint is deployed)"
    systemctl list-timers "$unit_name.timer" --no-pager </dev/null 2>/dev/null | sed 's/^/    /' || true
  fi
  [ ! -e "$legacy_state" ] || warn "$legacy_state (the old deploy key and clone) is still there: a real run of this stage removes it"
  [ "$rc" -eq 0 ] || die "the check failed (see above)"
  say "stage 35 check: ok"
  exit 0
fi

if [ "$undo" = 1 ]; then
  say "undo: remove the timer, the service and the installed files"
  if [ "$dry" = 1 ]; then say "DRY_RUN=1: nothing changed"; exit 0; fi
  if have_systemd; then
    systemctl stop "$unit_name.timer" 2>/dev/null || true
    systemctl disable "$unit_name.timer" >/dev/null 2>&1 || true
  fi
  rm -f "${timer_file:?}" "${service_file:?}"
  rm -rf "${dest:?}"
  have_systemd && systemctl daemon-reload
  ok "removed the units and $dest"
  say "stage 35 done: removed"
  exit 0
fi

say "checking before anything is written"
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
command -v curl >/dev/null 2>&1 || die "curl is missing"
for f in $files; do
  [ -f "$src_dir/$f" ] || die "$src_dir/$f is missing: scp scripts/who-uses-what.mjs scripts/pi/who-uses-what-push.sh foundry-pi:/root/ first"
done
"$NODE_DIR/bin/node" --check "$src_dir/who-uses-what.mjs" || die "who-uses-what.mjs does not parse on this Node"
bash -n "$src_dir/who-uses-what-push.sh" || die "who-uses-what-push.sh does not parse"
[ -f "$access_env" ] && grep -qE '^[[:space:]]*GM_DASHBOARD_TOKEN=[^[:space:]]' "$access_env" ||
  die "$access_env has no GM_DASHBOARD_TOKEN: the dashboard would refuse the report (run set-dashboard-access.sh first)"
check_board_conf
ok "sources, Node, curl, the GM token and the board token file (names only, nothing printed) are in place"

plan_files="install $dest"
cmp_all=1
for f in $files; do cmp -s "$src_dir/$f" "$dest/$f" 2>/dev/null || cmp_all=0; done
[ "$cmp_all" = 1 ] && plan_files="nothing to do"
plan_units="write the service and the timer"
[ -f "$service_file" ] && [ "$(cat "$service_file")" = "$want_service" ] && [ -f "$timer_file" ] && [ "$(cat "$timer_file")" = "$want_timer" ] && plan_units="nothing to do"
plan_legacy="nothing to do"
if [ -L "$legacy_state" ]; then plan_legacy="$legacy_state is a symbolic link: refuse"
elif [ -e "$legacy_state" ]; then plan_legacy="remove $legacy_state (the old deploy key and vault clone)"; fi
say "plan: files: $plan_files; units: $plan_units; old deploy key and clone: $plan_legacy; timer: turned off first (an earlier version's timer may be enabled); then one reading sent to the board, and the timer enabled when it worked"
if [ "$dry" = 1 ]; then
  say "DRY_RUN=1: nothing changed"
  exit 0
fi
[ ! -L "$legacy_state" ] || die "$legacy_state is a symbolic link: refusing (remove it by hand after looking at it)"

if have_systemd; then
  say "the timer off until a reading is accepted (an earlier version's timer may be enabled and its job running)"
  systemctl disable --now "$unit_name.timer" >/dev/null 2>&1 || true
  systemctl stop "$unit_name.service" >/dev/null 2>&1 || true
fi

say "the files"
if [ "$cmp_all" = 1 ]; then
  ok "$dest already has both files"
else
  install -d -m 0755 -o root -g root "$dest"
  for f in $files; do install -m 0644 -o root -g root "$src_dir/$f" "$dest/$f"; done
  ok "installed $files in $dest"
fi
(cd "$dest" && sha256sum $files >SHA256SUMS)
chmod 0644 "$dest/SHA256SUMS"
sed 's/^/    /' "$dest/SHA256SUMS" || true

say "the units"
write_file "$service_file" 0644 "$want_service" || true
write_file "$timer_file" 0644 "$want_timer" || true

if [ -e "$legacy_state" ]; then
  say "the old vault deploy key and clone"
  # A folder inside our own state area (/var/lib/foundry*); rm -rf does not follow links inside it. The key stays valid on GitHub
  # until the user deletes it there (Settings, Deploy keys on Gnuminator/obsidian-vault).
  rm -rf "${legacy_state:?}"
  ok "removed $legacy_state; delete the deploy key on GitHub too (repo Gnuminator/obsidian-vault, Settings, Deploy keys)"
fi

if ! have_systemd; then
  warn "no systemd here (a test container?): files and units written, nothing started"
  say "stage 35 done"
  exit 0
fi
systemctl daemon-reload

say "one reading now (it is sent to the board)"
if ! systemctl start "$unit_name.service"; then
  journalctl -u "$unit_name.service" -n 8 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
  die "the reading failed (most likely the board's who-uses-what endpoint is not deployed yet, or it refused the Pi's token); the timer is NOT enabled. Fix that, then run this stage again"
fi
ok "the reading was sent"
journalctl -u "$unit_name.service" -n 4 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
systemctl enable --now "$unit_name.timer" >/dev/null 2>&1 || die "could not enable $unit_name.timer"
ok "$unit_name.timer enabled"
systemctl list-timers "$unit_name.timer" --no-pager </dev/null 2>/dev/null | sed 's/^/    /' || true

ok "next: the board's Who tab shows the reading after the board reads it from its store"
say "stage 35 done"
