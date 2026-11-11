#!/usr/bin/env bash
# Stage 32: crash-loop guard and clock check for the services that stay on systemd (backlog pi-crash-loops-clock).
#
# The problem: the bridge and the dashboard have Restart=always, RestartSec=5 and no limit, so a broken build restarts every
# 5 seconds for ever and nobody hears of it; Foundry has Restart=on-failure, so a clean exit (code 0) leaves it down with no
# alert at all; the Assistant GM browser restarts every 15 seconds for ever; and nothing watches the clock (a drifting clock
# breaks Cloudflare Access tokens and the backup and board timestamps; stage 18 sets NTP up but nothing checks it later).
#
# What it changes (all of it under /etc/systemd/system, $TOOL_DIR/crash-guard and one state folder; no unit file written by
# an earlier stage is edited, so a later run of stage 3 or 5 keeps the guard):
#   1. drop-ins  <unit>.d/10-crash-guard.conf  for foundry, foundry-ai-tool-bridge, foundry-ai-tool-dashboard and, when it
#      is a systemd unit that is enabled, foundry-ai-tool-gm-browser: StartLimitIntervalSec and StartLimitBurst (a crash loop
#      stops after a few minutes instead of for ever), OnFailure=foundry-ai-tool-alert@%n.service (the stop is announced) and,
#      for Foundry only, Restart=always (a clean exit no longer leaves the world down). A unit that is not there is skipped
#      with a note (the stack may run as containers: the compose stage owns those).
#   2. foundry-ai-tool-alert@.service: a oneshot as $FOUNDRY_USER that posts one fixed line to #gm-bot with the bot token from
#      discord-bot.env (needs GAMENIGHT_WATCH_CHANNEL_ID too, written by stage 26). Without them it only writes the journal.
#      The post carries the unit name and nothing else: no address, no log line, no token (the token goes in on stdin).
#   3. foundry-ai-tool-clock-check.service and .timer: every 15 minutes, checks that systemd-timesyncd is on and the clock is
#      synchronized (timedatectl). Two bad checks in a row post "clock not synchronized" once, the first good check after
#      that posts "clock back"; while bad the service shows as failed in systemctl.
# It restarts nothing: the daemon is reloaded (the new limits apply to running units at once), no service stops, so it needs
# no quiet check and drops no player. It does not touch a world or a Foundry setting. A snapshot first.
# A unit that trips its start limit stays down until `systemctl reset-failed <unit> && systemctl start <unit>`; the alert says so.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    read back the drop-ins, units and timer and run one clock check without posting; changes nothing; exit 1 when a
#              piece is missing or the clock is not synchronized
#   UNDO=1     remove the drop-ins, the units, the installed scripts and the state folder
# A real run (and UNDO) needs a dietpi-backup snapshot from today and the user's OK. These lines are bash:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/32-crash-guard.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/32-crash-guard.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/32-crash-guard.sh | ssh foundry-pi 'CHECK=1 bash -s'
# Tests only: UNIT_DIR (TOOL_ETC, TOOL_DIR and NODE_DIR are set by lib.sh, so they are not overrides).

dry="${DRY_RUN:-0}"
check="${CHECK:-0}"
undo="${UNDO:-0}"
unit_dir="${UNIT_DIR:-/etc/systemd/system}"
dest="$TOOL_DIR/crash-guard"
bot_env="$TOOL_ETC/discord-bot.env"
alert_unit=foundry-ai-tool-alert@.service
clock_service=foundry-ai-tool-clock-check.service
clock_timer=foundry-ai-tool-clock-check.timer
state_name=foundry-ai-tool-crash-guard
guarded="foundry.service foundry-ai-tool-bridge.service foundry-ai-tool-dashboard.service foundry-ai-tool-gm-browser.service"

require_root
# Over a non-login ssh the sbin folders may not be on PATH.
PATH="$PATH:/usr/sbin:/sbin"
modes=0
for m in "$dry" "$check" "$undo"; do [ "$m" = 1 ] && modes=$((modes + 1)); done
[ "$modes" -le 1 ] || die "use one of DRY_RUN=1, CHECK=1 and UNDO=1, not several"
if [ "$dry" != 1 ] && [ "$check" != 1 ]; then require_recent_snapshot; fi

has_key() { grep -qE "^[[:space:]]*$2=[^[:space:]]" "$1" 2>/dev/null; }

# ---- the two scripts the units run (installed root:root 0755 into $dest) --------------------------------------
read -r -d '' alert_script <<'EOF' || true
#!/usr/bin/env bash
# Foundry AI Tool crash guard: one fixed line to #gm-bot. Argument: "unit <name>", "clock-bad" or "clock-ok".
# The token goes to curl on stdin (never on a command line); nothing printed or posted holds it.
set -u
kind="${1:-}"
name="${2:-}"
case "$kind" in
  unit)
    [[ "$name" =~ ^[A-Za-z0-9@:._-]{1,100}$ ]] || { echo "alert: refusing odd unit name"; exit 0; }
    text="Pi: $name keeps failing and systemd stopped restarting it. Look at journalctl -u $name, then: systemctl reset-failed $name && systemctl start $name"
    ;;
  clock-bad) text="Pi: the clock is not synchronized with NTP (Cloudflare Access tokens and backup timestamps depend on it). Run stage 18 with CHECK=1." ;;
  clock-ok) text="Pi: the clock is synchronized with NTP again." ;;
  *) echo "alert: unknown kind"; exit 0 ;;
esac
echo "alert: $kind ${name:-}"
if [ -z "${DISCORD_TOKEN:-}" ] || [ -z "${GAMENIGHT_WATCH_CHANNEL_ID:-}" ]; then
  echo "alert: no Discord token or #gm-bot channel in discord-bot.env: journal only"
  exit 0
fi
[[ "$GAMENIGHT_WATCH_CHANNEL_ID" =~ ^[0-9]{5,25}$ ]] || { echo "alert: the channel id looks wrong: journal only"; exit 0; }
api="${DISCORD_API:-https://discord.com/api/v10}"
body="$(printf '{"content":"%s"}' "$text")"
if printf 'header = "Authorization: Bot %s"\nheader = "Content-Type: application/json"\n' "$DISCORD_TOKEN" |
  curl -sS -o /dev/null -f --max-time 20 -K - -X POST --data "$body" "$api/channels/$GAMENIGHT_WATCH_CHANNEL_ID/messages"; then
  echo "alert: posted"
else
  echo "alert: the post failed (journal only)"
fi
exit 0
EOF

read -r -d '' clock_script <<'EOF' || true
#!/usr/bin/env bash
# Foundry AI Tool crash guard: is the clock under NTP? Exit 0 when yes, 1 when not. Two bad checks in a row post once;
# the first good check after that posts the recovery. DRY=1 (the stage's CHECK) prints and posts nothing, keeps no state.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
state_dir="${STATE_DIRECTORY:-/var/lib/foundry-ai-tool-crash-guard}"
state="$state_dir/clock-bad-count"
ntp="$(timedatectl show -p NTP --value 2>/dev/null || true)"
sync="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)"
echo "clock: NTP service=${ntp:-unknown} synchronized=${sync:-unknown}"
if [ "${DRY:-0}" = 1 ]; then
  [ "$ntp" = yes ] && [ "$sync" = yes ]
  exit $?
fi
mkdir -p "$state_dir" 2>/dev/null || true
count=0
[ -f "$state" ] && count="$(cat "$state" 2>/dev/null || echo 0)"
[[ "$count" =~ ^[0-9]+$ ]] || count=0
if [ "$ntp" = yes ] && [ "$sync" = yes ]; then
  if [ "$count" -ge 2 ]; then "$here/alert.sh" clock-ok || true; fi
  echo 0 >"$state" 2>/dev/null || true
  exit 0
fi
count=$((count + 1))
echo "$count" >"$state" 2>/dev/null || true
echo "clock: not synchronized ($count in a row)"
if [ "$count" -eq 2 ]; then "$here/alert.sh" clock-bad || true; fi
exit 1
EOF

# ---- the unit texts --------------------------------------------------------------------------------------------
common_service="User=$FOUNDRY_USER
Group=$FOUNDRY_USER
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true"

want_alert="[Unit]
Description=Foundry AI Tool: say in #gm-bot that %i keeps failing

[Service]
Type=oneshot
$common_service
EnvironmentFile=-$bot_env
ExecStart=$dest/alert.sh unit %i
TimeoutStartSec=40"

want_clock="[Unit]
Description=Foundry AI Tool: is the Pi's clock under NTP?
After=network-online.target

[Service]
Type=oneshot
$common_service
StateDirectory=$state_name
EnvironmentFile=-$bot_env
ExecStart=$dest/clock-check.sh
TimeoutStartSec=60"

want_timer="[Unit]
Description=Foundry AI Tool: clock check every 15 minutes

[Timer]
OnBootSec=10min
OnUnitActiveSec=15min
AccuracySec=1min

[Install]
WantedBy=timers.target"

dropin_text() { # $1 unit
  local burst=30 interval=600
  case "$1" in foundry.service) burst=10 interval=300 ;; foundry-ai-tool-gm-browser.service) burst=10 interval=600 ;; esac
  printf '%s\n' "# Written by stage 32 (scripts/pi/remote/32-crash-guard.sh): a crash loop stops after $burst starts in $interval s and is announced."
  printf '[Unit]\nStartLimitIntervalSec=%s\nStartLimitBurst=%s\nOnFailure=foundry-ai-tool-alert@%%n.service\n' "$interval" "$burst"
  if [ "$1" = foundry.service ]; then
    printf '\n[Service]\n# a clean exit (code 0) used to leave Foundry down; a stop on purpose (the nightly backup) is still respected\nRestart=always\n'
  fi
}

# Which guarded units exist here. gm-browser also has to be enabled when systemd runs (a compose cut-over disables it).
present=""
absent=""
for u in $guarded; do
  if [ -f "$unit_dir/$u" ] && { ! have_systemd || [ "$u" != foundry-ai-tool-gm-browser.service ] || systemctl is-enabled --quiet "$u" 2>/dev/null; }; then
    present="$present $u"
  else
    absent="$absent $u"
  fi
done

dropin_file() { printf '%s/%s.d/10-crash-guard.conf' "$unit_dir" "$1"; }

# ---- CHECK -----------------------------------------------------------------------------------------------------
if [ "$check" = 1 ]; then
  say "check: the guard, read back"
  bad=0
  for u in $present; do
    f="$(dropin_file "$u")"
    if [ -f "$f" ] && [ "$(cat "$f")" = "$(dropin_text "$u")" ]; then
      ok "$u: drop-in in place"
      if have_systemd; then
        systemctl show -p Restart -p StartLimitBurst -p OnFailure "$u" 2>/dev/null | sed 's/^/    /' || true
      fi
    else
      warn "$u: drop-in missing or changed"
      bad=1
    fi
  done
  for u in $absent; do ok "$u: not a systemd unit here, skipped"; done
  [ -x "$dest/alert.sh" ] && [ -x "$dest/clock-check.sh" ] || { warn "the scripts in $dest are missing"; bad=1; }
  [ -f "$unit_dir/$alert_unit" ] && [ -f "$unit_dir/$clock_service" ] && [ -f "$unit_dir/$clock_timer" ] || { warn "the alert or clock units are missing in $unit_dir"; bad=1; }
  if have_systemd; then
    systemctl is-active --quiet "$clock_timer" && ok "$clock_timer is active" || { warn "$clock_timer is not active"; bad=1; }
  fi
  if [ -x "$dest/clock-check.sh" ]; then
    DRY=1 "$dest/clock-check.sh" | sed 's/^/    /' || bad=1
  fi
  [ "$bad" = 0 ] || die "the crash guard is incomplete or the clock is not synchronized (see above)"
  say "stage 32 check: ok"
  exit 0
fi

# ---- UNDO ------------------------------------------------------------------------------------------------------
if [ "$undo" = 1 ]; then
  say "undo: remove the guard"
  if [ "$dry" = 1 ]; then say "DRY_RUN=1: nothing changed"; exit 0; fi
  if have_systemd; then
    systemctl stop "$clock_timer" 2>/dev/null || true
    systemctl disable "$clock_timer" >/dev/null 2>&1 || true
  fi
  for u in $guarded; do
    rm -f "${unit_dir:?}/$u.d/10-crash-guard.conf"
    rmdir "${unit_dir:?}/$u.d" 2>/dev/null || true
  done
  rm -f "${unit_dir:?}/$alert_unit" "${unit_dir:?}/$clock_service" "${unit_dir:?}/$clock_timer"
  rm -rf "${dest:?}" "/var/lib/${state_name:?}"
  have_systemd && systemctl daemon-reload
  ok "removed the drop-ins, the units, $dest and the state folder"
  say "stage 32 done: removed"
  exit 0
fi

# ---- the plan --------------------------------------------------------------------------------------------------
say "checking before anything is written"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
command -v curl >/dev/null 2>&1 || die "curl not found"
[ -n "$present" ] || die "none of the guarded units exists in $unit_dir ($guarded): nothing to guard"
if [ -f "$bot_env" ] && has_key "$bot_env" DISCORD_TOKEN && has_key "$bot_env" GAMENIGHT_WATCH_CHANNEL_ID; then
  ok "the bot token and #gm-bot are in $bot_env: alerts will be posted"
else
  warn "no bot token or #gm-bot line in $bot_env (stages 8 and 26): alerts will reach the journal only until they are there"
fi
for u in $present; do
  f="$(dropin_file "$u")"
  if [ -f "$f" ] && [ "$(cat "$f")" = "$(dropin_text "$u")" ]; then ok "$u: drop-in already in place"; else ok "$u: would write $f"; fi
done
for u in $absent; do ok "$u: not here (or disabled): skipped"; done
ok "would write $alert_unit, $clock_service, $clock_timer and the scripts in $dest; nothing is restarted"
if [ "$dry" = 1 ]; then
  say "DRY_RUN=1: nothing changed"
  exit 0
fi

# ---- the real run ----------------------------------------------------------------------------------------------
say "the scripts"
install -d -m 0755 -o root -g root "$dest"
printf '%s\n' "$alert_script" >"$dest/alert.sh.new"
printf '%s\n' "$clock_script" >"$dest/clock-check.sh.new"
for f in alert.sh clock-check.sh; do
  bash -n "$dest/$f.new" || { rm -f "${dest:?}/$f.new"; die "$f does not parse: nothing was installed"; }
  install -m 0755 -o root -g root "$dest/$f.new" "$dest/$f"
  rm -f "${dest:?}/$f.new"
done
(cd "$dest" && sha256sum alert.sh clock-check.sh) | sed 's/^/    /' || true
ok "installed alert.sh and clock-check.sh in $dest"

say "the units"
write_file "$unit_dir/$alert_unit" 0644 "$want_alert" || true
write_file "$unit_dir/$clock_service" 0644 "$want_clock" || true
write_file "$unit_dir/$clock_timer" 0644 "$want_timer" || true

say "the drop-ins"
for u in $present; do
  install -d -m 0755 "$unit_dir/$u.d"
  write_file "$(dropin_file "$u")" 0644 "$(dropin_text "$u")" || true
done

say "start"
if have_systemd; then
  systemctl daemon-reload
  systemctl enable --now "$clock_timer" >/dev/null 2>&1 || die "could not enable $clock_timer"
  systemctl is-active --quiet "$clock_timer" || die "$clock_timer is not active: systemctl status $clock_timer"
  for u in $present; do
    got="$(systemctl show -p OnFailure --value "$u" 2>/dev/null || true)"
    case "$got" in
      *foundry-ai-tool-alert@*) ok "$u: OnFailure is $got" ;;
      *) die "$u: the drop-in did not load (OnFailure='$got'): systemctl status $u" ;;
    esac
  done
  systemd-analyze verify "$unit_dir/$alert_unit" "$unit_dir/$clock_service" "$unit_dir/$clock_timer" 2>&1 | sed 's/^/    /' || true
  ok "$clock_timer active; the first clock check runs within minutes"
else
  warn "no systemd here (a test container?): files written, nothing started"
fi
ok "next: CHECK=1 reads it all back; a tripped unit stays down until: systemctl reset-failed <unit> && systemctl start <unit>"
say "stage 32 done"
