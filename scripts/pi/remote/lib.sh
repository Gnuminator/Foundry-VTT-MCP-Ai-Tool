#!/usr/bin/env bash
# Shared helpers for the Orange Pi stage scripts (docs/dev/PI-SETUP.md, Part B).
# Claude runs each stage from the PC:  ssh foundry-pi 'bash -s' < scripts/pi/remote/<stage>.sh
# Every stage is safe to run again: it checks what is already there and only adds what is missing.

set -euo pipefail
# Files a stage makes are readable by the services (they run as foundry): never inherit a strict
# umask from the SSH session (stage 9's wrapper once passed on 077, and a stage 5 build came out
# root-only, so the bridge could not start; 2026-10-06). Secrets get their own modes where written.
umask 022

FOUNDRY_USER=foundry
NODE_DIR=/opt/node24
FOUNDRY_APP=/opt/foundry
FOUNDRY_DATA=/var/lib/foundry
TOOL_DIR=/opt/foundry-ai-tool
TOOL_ETC=/etc/foundry-ai-tool
TOOL_DATA=/var/lib/foundry-ai-tool

say() { printf '==> %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "run as root (the Pi's SSH login is root)"
}

require_arm64() {
  local arch
  arch="$(uname -m)"
  [ "$arch" = "aarch64" ] || die "expected an ARM64 board (aarch64), got $arch"
}

# True when systemd runs (not in a test container).
have_systemd() {
  [ -d /run/systemd/system ]
}

# Install Debian packages that are missing.
apt_install() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    say "installing ${missing[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" >/dev/null
  fi
}

# Files write_file changed in this run (space separated, a space on both sides), so enable_unit can tell a unit
# whose files changed from one that is only being "set up again".
LIB_CHANGED=" "
file_changed() {
  case "$LIB_CHANGED" in *" $1 "*) return 0 ;; esac
  return 1
}
# mark_changed PATH...: for a file a stage changed another way than write_file (an installed build, a copied file).
mark_changed() {
  local p
  for p in "$@"; do LIB_CHANGED="$LIB_CHANGED$p "; done
}

# Write a file only when its content changes; returns 0 when it did, 1 when it was already like that.
write_file() {
  local path="$1" mode="$2" content="$3"
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then
    ok "$path unchanged"
    return 1
  fi
  printf '%s\n' "$content" >"$path"
  chmod "$mode" "$path"
  LIB_CHANGED="$LIB_CHANGED$path "
  ok "wrote $path"
  return 0
}

# enable_unit UNIT [DEPENDENCY_FILE...]: enable the unit and make sure it runs, when systemd runs (otherwise only
# report). A unit that already runs is restarted ONLY when its own unit file changed in this run (write_file or
# mark_changed) or is newer than the running service, likewise one of the DEPENDENCY_FILEs (its EnvironmentFile,
# say), or when RESTART_UNITS=1. A rerun
# that changed nothing leaves a running service alone: a restart drops the players (Foundry) or the GM link (bridge,
# dashboard, Assistant GM) and ends a recording. A stopped unit is started.
enable_unit() {
  local unit="$1" f restart=0 reason="" started=""
  shift
  if have_systemd; then
    systemctl daemon-reload
    systemctl enable "$unit" >/dev/null 2>&1
    if ! systemctl is-active --quiet "$unit"; then
      systemctl start "$unit"
    else
      # "Changed" is this run's write_file/mark_changed, or a file written after the unit last started: a refused
      # restart (require_quiet) leaves the new file on disk, and the rerun later must still restart the service.
      started="$(unit_started_epoch "$unit")"
      for f in "/etc/systemd/system/$unit" "$@"; do
        if file_changed "$f"; then
          restart=1 reason="$f changed"
        elif [ -n "$started" ] && [ -f "$f" ] && [ "$(stat -c %Y "$f")" -gt "$started" ]; then
          restart=1 reason="$f is newer than the running service"
        fi
      done
      if [ "${RESTART_UNITS:-0}" = 1 ]; then restart=1 reason="RESTART_UNITS=1"; fi
      if [ "$restart" = 1 ]; then
        require_quiet "restarting $unit ($reason)"
        say "restarting $unit ($reason)"
        systemctl restart "$unit"
      fi
    fi
    sleep 2
    systemctl is-active --quiet "$unit" || die "$unit did not start; see: journalctl -u $unit -n 50"
    if [ "$restart" = 1 ]; then ok "$unit restarted"; else ok "$unit running (not restarted: nothing it uses changed)"; fi
  else
    warn "no systemd here (a test container?): $unit written, not started"
  fi
}

# ---- Game-night guards ----------------------------------------------------------------------------------------
# A stage that stops or restarts a service must not do it while players are online or a recording runs, and no stage
# changes the Pi without a dietpi-backup snapshot from today (pi-work rule; r37 S1 to S4, R8). FORCE=1 (in front of
# bash on the ssh line: ... | ssh foundry-pi 'FORCE=1 bash -s') overrides a refusal, with a warning.
FORCE="${FORCE:-0}"

# refuse MESSAGE: die with MESSAGE and how to override; with FORCE=1 only warn.
refuse() {
  if [ "$FORCE" = 1 ]; then
    warn "$1 (FORCE=1: going on)"
  else
    die "$1. Run this when it is quiet, or put FORCE=1 in front of bash to go on anyway"
  fi
}

# users_online: prints how many users Foundry's /api/status counts ("0" on the setup screen, which has no users
# field) and "?" when it cannot be read. Read-only.
users_online() {
  local out
  out="$(curl -fs --max-time 5 http://127.0.0.1:30000/api/status 2>/dev/null |
    "$NODE_DIR/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).users;process.stdout.write(String(Number.isInteger(u)?u:0))}catch{process.stdout.write("?")}})' 2>/dev/null)" || out="?"
  printf '%s' "${out:-?}"
}

# unit_started_epoch UNIT: prints when the unit last became active (epoch seconds), or nothing when unknown.
unit_started_epoch() {
  local ts
  ts="$(systemctl show -p ActiveEnterTimestamp --value "$1" 2>/dev/null || true)"
  [ -n "$ts" ] || return 0
  date -d "$ts" +%s 2>/dev/null || true
}

# recording_active [DIR]: 0 when a Discord recording seems to run: a session folder under DIR (default
# $TOOL_DATA/recordings) whose raw/ has no session.json yet (the bot writes it when the recording stops) and either
# has a file changed in the last 10 minutes or, while the bot service runs, was last changed after the bot last
# started (the bot writes nothing while nobody speaks, so a long break must not look like "no recording"; a crashed
# session from before the last start does not count). Read-only.
recording_active() {
  local dir="${1:-$TOOL_DATA/recordings}" raw since=""
  [ -d "$dir" ] || return 1
  if have_systemd && systemctl is-active --quiet foundry-ai-tool-discord-bot.service; then
    since="$(unit_started_epoch foundry-ai-tool-discord-bot.service)"
  fi
  for raw in "$dir"/*/raw; do
    [ -d "$raw" ] || continue
    # Finished: stopped cleanly (session.json), or converted after a crash (convert-report.json / convert-failed.json).
    [ -f "$raw/session.json" ] && continue
    [ -f "$raw/convert-report.json" ] && continue
    [ -f "$raw/convert-failed.json" ] && continue
    if [ -n "$(find "$raw" -type f -mmin -10 -print -quit 2>/dev/null)" ]; then return 0; fi
    if [ -n "$since" ] && [ -n "$(find "$raw" -maxdepth 0 -newermt "@$since" -print 2>/dev/null)" ]; then return 0; fi
  done
  return 1
}

# require_no_recording WHAT: refuses while a Discord recording runs (stopping or restarting the bot ends it).
require_no_recording() {
  have_systemd || return 0
  if recording_active; then
    refuse "a Discord recording is in progress (a session folder in $TOOL_DATA/recordings without session.json, written to in the last 10 minutes): $1 would end it"
  fi
}

# require_quiet WHAT: call before a stage stops or restarts Foundry (WHAT names the action). Refuses while players are
# online (the Assistant GM browser counts as one user while its service runs) or a recording runs. Does nothing
# without systemd; Foundry not running means no one to drop.
require_quiet() {
  local what="$1" online assistant=0
  have_systemd || return 0
  if systemctl is-active --quiet foundry.service; then
    online="$(users_online)"
    systemctl is-active --quiet foundry-ai-tool-gm-browser.service && assistant=1
    if [ "$online" = "?" ]; then
      refuse "cannot read who is online in Foundry (/api/status on port 30000), so $what is not safe"
    elif [ "$online" -gt "$assistant" ]; then
      refuse "$((online - assistant)) player(s) are online in Foundry: $what would drop them"
    fi
  fi
  require_no_recording "$what"
}

# require_recent_snapshot: refuses unless a dietpi-backup snapshot COMPLETED today: the last "Backup completed" line
# in /mnt/dietpi-backup/.dietpi-backup_stats (format "2026-10-18_09:46:24  Backup completed"; the file's mtime is not
# used, a started, cancelled or restore run touches it too). The nightly one at 01:25 counts. Skipped off DietPi (a
# test container). Take one with: /boot/dietpi/dietpi-backup 1
# It has its own switch, NO_SNAPSHOT=1, so a new Pi (stages 1 to 4, no snapshot yet) does not need FORCE=1, which
# would also switch off the players and recording checks. FORCE=1 does not skip this check.
require_recent_snapshot() {
  local stats="${DIETPI_BACKUP_STATS:-/mnt/dietpi-backup/.dietpi-backup_stats}" last="" last_when day
  if [ ! -d "${DIETPI_DIR:-/boot/dietpi}" ]; then
    warn "not DietPi (a test container?): the snapshot check is skipped"
    return 0
  fi
  if [ -f "$stats" ]; then last="$(grep 'Backup completed' "$stats" | tail -n 1 || true)"; fi
  day="$(date +%F)"
  last_when="${last%% *}"
  case "$last" in
    "${day}_"*)
      ok "dietpi-backup snapshot from today ($last_when)"
      return 0
      ;;
  esac
  if [ "${NO_SNAPSHOT:-0}" = 1 ]; then
    warn "no dietpi-backup snapshot from today (last completed: ${last_when:-none}); NO_SNAPSHOT=1: going on without one"
    return 0
  fi
  die "no dietpi-backup snapshot completed today (last: ${last_when:-none}). Take one first: /boot/dietpi/dietpi-backup 1 (a brand-new Pi with nothing to lose: put NO_SNAPSHOT=1 in front of bash)"
}

# warn_dashboard_split: the co-GM dashboard treats every caller as the GM until GM_DASHBOARD_TOKEN or GM_EMAILS is set
# (by set-dashboard-access.sh, in $TOOL_ETC/dashboard-access.env). Without them everyone who reaches port 3000 (over
# Tailscale or the tunnel) sees the GM view. Reads names only, never values. Returns 0 when the split is on.
warn_dashboard_split() {
  local f="$TOOL_ETC/dashboard-access.env"
  if [ -f "$f" ] && grep -Eq '^(GM_DASHBOARD_TOKEN|GM_EMAILS)=.+' "$f"; then
    ok "dashboard player/GM split is on ($f sets a GM token or GM emails)"
    return 0
  fi
  warn "the dashboard player/GM split is OFF: $f has no GM_DASHBOARD_TOKEN or GM_EMAILS, so everyone who reaches port 3000 (Tailscale, the tunnel) is treated as the GM and sees spoilers. Run scripts/pi/remote/set-dashboard-access.sh in your own SSH session (docs/dev/REMOTE-ACCESS.md, Part C, step 10)"
  return 1
}

# ---- Writes into folders the foundry user owns --------------------------------------------------------
# Root must not write there: a link the foundry user left at the destination (or at a temp name) would make root
# write over any file, and a chown would hand it to the foundry user. These two helpers run the write as the foundry
# user, to a temp file next to the target (same mode) that is renamed over it, so a failure never leaves a half file
# and the target keeps its mode (its owner becomes the foundry user). The temp name is <target>.foundry-tmp; a leftover or a link there is
# removed first. $NODE_DIR/bin/node must exist (check it up front).

# True when the foundry user can write in directory $1 (read-only check, for the up-front refusals).
foundry_can_write() {
  runuser -u "$FOUNDRY_USER" -- test -w "$1"
}

# foundry_edit_json FILE JS [ARG...]: edits the JSON file as the foundry user. JS is the body of a function of
# (o, a): o is the parsed object (change it in place), a the ARGs. Example:
#   foundry_edit_json "$options" 'o.world = a[0] || null' "$world"
foundry_edit_json() {
  local file="$1" body="$2"
  shift 2
  runuser -u "$FOUNDRY_USER" -- "$NODE_DIR/bin/node" -e 'const fs=require("fs");const [p,body,...a]=process.argv.slice(1);const st=fs.statSync(p);const o=JSON.parse(fs.readFileSync(p,"utf8"));new Function("o","a",body)(o,a);const t=p+".foundry-tmp";fs.rmSync(t,{force:true});fs.writeFileSync(t,JSON.stringify(o,null,2)+"\n",{mode:st.mode&0o777});fs.chmodSync(t,st.mode&0o777);fs.renameSync(t,p)' "$file" "$body" "$@"
}

# foundry_copy_file SRC DST: copies a file as the foundry user (cp -a, so mode and times are kept), through a temp
# file and a rename. Used for the saved copy of options.json and for putting it back.
foundry_copy_file() {
  runuser -u "$FOUNDRY_USER" -- sh -c 't="$2.foundry-tmp"; rm -f "$t" && cp -a "$1" "$t" && mv -f "$t" "$2"' sh "$1" "$2"
}

# control_port_check [PORT]: the bridge's control port (default 31414), which the Cloudflare TCP route
# (D-095, mcp.<domain>) points at. It has no login of its own, so it must listen on loopback only.
# Returns 0 = answers a ping on loopback and nothing listens beyond loopback, 1 = no ping answer,
# 2 = a listener beyond loopback (checked first). Read-only.
control_port_check() {
  local port="${1:-31414}" listeners reply=""
  listeners="$(ss -ltnH "sport = :$port" 2>/dev/null | awk '{print $4}' || true)"
  if [ -n "$listeners" ] && printf '%s\n' "$listeners" | grep -qvE '^(127\.0\.0\.1|\[::1\]):'; then
    return 2
  fi
  reply="$( { exec 3<>"/dev/tcp/127.0.0.1/$port"; printf '{"id":"ping","method":"ping"}\n' >&3; IFS= read -r -t 5 -u 3 line; printf '%s' "${line:-}"; } 2>/dev/null )" || true
  case "$reply" in *'"ok":true'*) return 0 ;; esac
  return 1
}
