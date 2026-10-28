#!/usr/bin/env bash
# Stage 18: keep the Pi's clock under NTP (backlog pi-ntp). Cloudflare Access tokens (the tunnel, stage 16's hourly board
# report) are time-limited and the backup and board checks compare timestamps, so a drifting clock breaks them.
#
# Why it is needed: DietPi's default CONFIG_NTP_MODE=2 is "boot + daily": systemd-timesyncd syncs once, then DietPi stops
# it again (/etc/cron.daily/dietpi, dietpi-timesync). `timedatectl` then says "System clock synchronized: yes" (the kernel
# flag stays set for some hours after the last sync) but "NTP service: inactive", and the clock drifts until the next daily sync. Mode 4, "daemon + drift",
# keeps systemd-timesyncd running and enabled. The change is made the DietPi way, so a later DietPi update or
# dietpi-config keeps it:  /boot/dietpi/func/dietpi-set_software ntpd-mode 4
# (writes CONFIG_NTP_MODE=4 to /boot/dietpi.txt, unmasks, enables and starts systemd-timesyncd, and re-applies
# CONFIG_NTP_MIRROR, "default" = the DHCP server's NTP or debian.pool.ntp.org).
#
# What it does, in this order, and stops before the next step when one fails:
#   1. refuses unless it runs on DietPi with systemd and the DietPi tool is there (dry run and check need only systemd);
#   2. reads the state: CONFIG_NTP_MODE, whether systemd-timesyncd is enabled and active, and timedatectl's NTP and
#      NTPSynchronized values;
#   3. when all of it is already right (mode 4, enabled, active) it changes nothing; otherwise it sets mode 4;
#   4. the check: waits up to 90 seconds for "NTP service: active" and "System clock synchronized: yes", prints
#      timedatectl and the timesync status, and fails when either is missing.
# Safe to run again. DietPi's tool also rewrites /etc/systemd/timesyncd.conf from CONFIG_NTP_MIRROR (default: removes it).
# Nothing else on the Pi is touched: no restart of any other service, the clock is slewed by
# timesyncd (it steps only when the offset is over 0.4 seconds), no reboot.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print the state and what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    only the check (step 4); changes nothing, needs no snapshot, exit 1 when not synchronized with NTP active
#   UNDO=1     back to DietPi's default mode 2 (boot + daily)
# A real run (and UNDO) needs a dietpi-backup snapshot from today. It changes DietPi's own settings, so it runs only after
# the user's OK, never on a game-night day. These lines are bash (Git Bash, or Claude's Bash tool), not PowerShell:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'CHECK=1 bash -s'
# Tests only: DIETPI_TXT and SET_SOFTWARE point at stand-ins, WAIT_SECONDS shortens the wait.

dry="${DRY_RUN:-0}"
check_only="${CHECK:-0}"
undo="${UNDO:-0}"
dietpi_txt="${DIETPI_TXT:-/boot/dietpi.txt}"
set_software="${SET_SOFTWARE:-/boot/dietpi/func/dietpi-set_software}"
wait_seconds="${WAIT_SECONDS:-90}"
unit=systemd-timesyncd.service

require_root
# Over a non-login ssh the sbin folders may not be on PATH.
PATH="$PATH:/usr/sbin:/sbin"
have_systemd || die "systemd is not running here: nothing to check or change"
command -v timedatectl >/dev/null 2>&1 || die "timedatectl not found"

read_mode() {
  sed -n '/^[[:blank:]]*CONFIG_NTP_MODE=/{s/^[^=]*=//p;q}' "$dietpi_txt" 2>/dev/null || true
}

# timedatectl show --value prints yes or no.
td() {
  timedatectl show -p "$1" --value 2>/dev/null || true
}

say "state before"
mode="$(read_mode)"
enabled="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
active="$(systemctl is-active "$unit" 2>/dev/null || true)"
echo "    CONFIG_NTP_MODE=${mode:-unset}  $unit: ${enabled:-unknown}, ${active:-unknown}"
echo "    NTP service: $(td NTP)  clock synchronized: $(td NTPSynchronized)"

# Waits for NTP active and the clock synchronized; 0 when both, 1 when the wait ran out.
wait_for_sync() {
  local i=0
  while :; do
    if [ "$(td NTP)" = yes ] && [ "$(td NTPSynchronized)" = yes ]; then return 0; fi
    [ "$i" -ge "$wait_seconds" ] && return 1
    sleep 3
    i=$((i + 3))
  done
}

run_check() {
  say "check"
  if wait_for_sync; then
    timedatectl | sed 's/^/    /'
    timedatectl timesync-status 2>/dev/null | sed 's/^/    /' || true
    ok "System clock synchronized: yes, NTP service: active"
    return 0
  fi
  timedatectl | sed 's/^/    /' >&2
  die "the clock is not synchronized with NTP active after ${wait_seconds}s (journalctl -u systemd-timesyncd -n 20 shows why)"
}

if [ "$check_only" = 1 ]; then
  run_check
  exit 0
fi

want=4
[ "$undo" = 1 ] && want=2

if [ "$want" = 4 ] && [ "$mode" = 4 ] && [ "$enabled" = enabled ] && [ "$active" = active ]; then
  ok "already in mode 4 with $unit running: nothing to change"
  if [ "$dry" = 1 ]; then
    say "dry run: the check below is all a real run would do"
  fi
  run_check
  exit 0
fi

if [ "$want" = 2 ] && [ "$mode" = 2 ]; then
  ok "already in DietPi's default mode 2: nothing to change"
  exit 0
fi

if [ "$dry" = 1 ]; then
  say "dry run: would run  $set_software ntpd-mode $want  (CONFIG_NTP_MODE=${mode:-unset} -> $want), then wait up to ${wait_seconds}s for the check; nothing changed"
  exit 0
fi

[ -f "$dietpi_txt" ] || die "$dietpi_txt not found: is this DietPi?"
[ -x "$set_software" ] || [ -f "$set_software" ] || die "$set_software not found: is this DietPi?"
require_recent_snapshot

say "setting DietPi time sync mode $want"
# </dev/null: this script arrives on bash's stdin (ssh ... 'bash -s'); a child that reads stdin would eat the rest of it.
bash "$set_software" ntpd-mode "$want" </dev/null || die "dietpi-set_software ntpd-mode $want failed (output above)"
[ "$(read_mode)" = "$want" ] || die "CONFIG_NTP_MODE is '$(read_mode)' after the change, expected $want"
ok "CONFIG_NTP_MODE=$want"

if [ "$want" = 4 ]; then
  run_check
else
  ok "back to boot + daily sync; $unit is stopped by DietPi until the next daily run"
fi
