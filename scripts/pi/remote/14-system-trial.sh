#!/usr/bin/env bash
# Stage 14: try a new dnd5e version on the kit world before the campaign gets it (D-098 update rule, D-110
# benchmark; docs/dev/PI-SETUP.md, "System trial (stage 14)"). The first case is dnd5e 6.0.5 to 6.0.6.
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/14-system-trial.sh | ssh foundry-pi 'MODE=trial bash -s'
# Every mode but status stops Foundry for a minute or two: take a snapshot first (/boot/dietpi/dietpi-backup 1) and
# get the user's OK for that mode, each time. Never on a game-night day.
#
# dnd5e is ONE folder (Data/systems/dnd5e) shared by every world on the Pi: curse-of-strahd, strahd-kit,
# frostmaiden-training and pi-check all run on whichever version is installed. A world migrates its data the first
# time it is launched on a new version, and a migrated world does not go back. So this stage launches only the kit
# world on the new version until the user picks "switch":
#   MODE=trial     keeps the installed version aside ($TRIAL/dnd5e-<version>), copies every world folder there as it
#                  is now, installs the pinned version (the download is checked against the pinned sha256) and
#                  launches only strahd-kit. Run the test kit on strahd-kit, then pick switch or rollback. Until then
#                  launch no other world (not the training world either): it would migrate, and the roll back puts
#                  such a world back only with RESTORE_MIGRATED=1, from the trial's copy, losing its changes since.
#   MODE=switch    (its own snapshot and OK) launches curse-of-strahd on the new version, which migrates the
#                  campaign. frostmaiden-training and pi-check migrate when they are next launched. The old version
#                  and the world copies stay in $TRIAL; removing them needs the user's OK. After a switch this stage
#                  has no roll back: that is a snapshot restore.
#   MODE=rollback  puts the old version back, resets strahd-kit from the trial's copy (its run on the new version is
#                  dropped) and launches the world Foundry ran before the trial (curse-of-strahd when it ran none).
#                  The new version, the trial's strahd-kit and the trial folder go to
#                  $IMPORT/prev-<stamp>-system-trial (never deleted). A rollback that stops halfway says so; run
#                  MODE=rollback again.
#   MODE=status    read-only: the trial's state, the installed version and each world's system version.
# Stages 5-check-world, 11 and 13 refuse to run while a trial is open (refuse_during_system_trial in lib.sh), and
# stage 5's check world never replaces an installed dnd5e.
# Before anything stops: the request and the trial state are checked, the zip must match the pinned sha256, its
# system.json must be dnd5e at the pinned version and fit this Foundry (compatibility.minimum and .maximum), the
# copies must fit (their bytes by du; under 5% free left over stops, under 20% warns), and nobody may be online
# (/api/status with the Assistant GM browser stopped; FORCE=1 overrides). A trial or switch that fails after Foundry
# stopped puts back what ran before it (the old version, strahd-kit or curse-of-strahd from the copy, options.json)
# and starts Foundry and the Assistant GM browser as they were, but launches a world again only when the dnd5e
# folder holds the version that world ran on. The Assistant GM browser rejoins whichever world runs.
# dnd5e migrates a world's data in the first GM client that joins it (here the Assistant GM browser), not when the
# server launches it. When the new version's flags.needsMigrationVersion asks for a migration of the launched world
# (its dnd5e.systemMigrationVersion setting, read from a copy of its settings database), trial and switch wait until
# that setting reaches the new version before they report success; a migration that does not finish in
# MIGRATION_WAIT seconds counts as a failure and is put back.
# One run at a time (a lock in $IMPORT); every line also goes to $IMPORT/system-trial.log, and a dropped SSH
# connection does not stop a run halfway (HUP and PIPE are ignored; the log shows how it ended).
# Env: MODE (required), ZIP (the release zip already under /var/lib/foundry-import; default: downloaded from the
#   pinned URL), FORCE (1 stops Foundry with people online), RESTORE_MIGRATED (rollback only: 1 also puts back a
#   world other than strahd-kit that was launched during the trial, from the trial's copy), MIGRATION_WAIT (seconds,
#   default 1800).

require_root
require_arm64
MODE="${MODE:-}"
ZIP="${ZIP:-}"
FORCE="${FORCE:-0}"
RESTORE_MIGRATED="${RESTORE_MIGRATED:-0}"
MIGRATION_WAIT="${MIGRATION_WAIT:-1800}"
# The version on trial. A new version is a new reviewed change to these four lines (the sha256 is the release
# asset's digest on GitHub: gh api repos/foundryvtt/dnd5e/releases/tags/release-<v> --jq '.assets[].digest').
SYSTEM=dnd5e
PIN_VERSION=6.0.6
PIN_URL=https://github.com/foundryvtt/dnd5e/releases/download/release-6.0.6/dnd5e-release-6.0.6.zip
PIN_SHA256=88c4013a5fb9aaaae18405b6a7eda69fd72c4f0b74920906c899c6df6b617595
KIT=strahd-kit
CAMPAIGN=curse-of-strahd
IMPORT=/var/lib/foundry-import
TRIAL="$IMPORT/system-trial"
data="$FOUNDRY_DATA/Data"
sysdir="$data/systems/$SYSTEM"
options="$FOUNDRY_DATA/Config/options.json"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"

case "$MODE" in trial | switch | rollback | status) ;; *) die "MODE must be trial, switch, rollback or status. Nothing was changed" ;; esac
case "$FORCE" in 0 | 1) ;; *) die "FORCE must be 0 or 1. Nothing was changed" ;; esac
case "$RESTORE_MIGRATED" in 0 | 1) ;; *) die "RESTORE_MIGRATED must be 0 or 1. Nothing was changed" ;; esac
[ "$RESTORE_MIGRATED" = 0 ] || [ "$MODE" = rollback ] || die "RESTORE_MIGRATED is for MODE=rollback only. Nothing was changed"
[ -z "$ZIP" ] || [ "$MODE" = trial ] || die "ZIP is for MODE=trial only. Nothing was changed"
[[ "$MIGRATION_WAIT" =~ ^[0-9]+$ ]] && [ "$MIGRATION_WAIT" -ge 10 ] || die "MIGRATION_WAIT must be a number of seconds, at least 10. Nothing was changed"
if [ "$MODE" != status ]; then
  install -d -m 700 "$IMPORT"
  exec 9>"$IMPORT/system-trial.lock"
  flock -n 9 || die "another stage 14 run holds $IMPORT/system-trial.lock. Nothing was changed"
  trap '' HUP PIPE
  STAGE_LOG="$IMPORT/system-trial.log"
  ok "MODE=$MODE started (this run is logged in $STAGE_LOG)"
fi

# ---- helpers -----------------------------------------------------------------------------------------------
# One string field of a JSON file (dotted path), printable and at most 60 characters; empty when missing.
json_get() { # $1 file, $2 key path such as compatibility.minimum
  node -e 'try{let v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split("."))v=v==null?undefined:v[k];if(v!=null)process.stdout.write(String(v).replace(/[^\w.+-]/g,"?").slice(0,60))}catch{}' "$1" "$2"
}
sys_version() { json_get "$1/system.json" version; }
# Foundry's compatibility bounds compare only as many parts as the bound has: "14" fits every 14.x build, and
# "14.367" fits 14.368.0. Exit 0 when version $1 is at least (ge) or at most (le) bound $2.
ver_bound() { # $1 version, $2 bound, $3 ge|le
  node -e 'const a=process.argv[1].split("."),b=process.argv[2].split(".");for(let i=0;i<b.length;i++){const x=Number(a[i]??0),y=Number(b[i]);if(!Number.isFinite(x)||!Number.isFinite(y))process.exit(2);if(x!==y)process.exit((process.argv[3]==="ge"?x>y:x<y)?0:1)}process.exit(0)' "$1" "$2" "$3"
}
state_get() { [ -f "$TRIAL/state" ] && sed -n "s/^$1=//p" "$TRIAL/state" | head -n1 || true; }
state_set() { # $1 key, $2 value: rewrites the state file with that one line changed (or added)
  { grep -v "^$1=" "$TRIAL/state" 2>/dev/null || true; printf '%s=%s\n' "$1" "$2"; } >"$TRIAL/state.new"
  mv "$TRIAL/state.new" "$TRIAL/state"
}
get_world() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.world||"")' "$options"; }
# Written to a temp file and renamed (owner and mode kept), so a full disk never leaves options.json cut short.
set_world() {
  node -e 'const fs=require("fs");const p=process.argv[1],t=p+".new";const o=JSON.parse(fs.readFileSync(p,"utf8"));o.world=process.argv[2]||null;const s=fs.statSync(p);fs.writeFileSync(t,JSON.stringify(o,null,2)+"\n",{mode:s.mode&0o777});fs.chownSync(t,s.uid,s.gid);fs.renameSync(t,p)' "$options" "$1"
}
# The world folders on the Pi (a folder with a world.json; README.txt and the like are skipped).
world_ids() {
  local w
  for w in "$data"/worlds/*/; do [ -f "$w/world.json" ] && basename "$w"; done
  return 0
}
# A world was launched since the trial began when any of its files is newer than the marker the trial wrote
# right after it copied the worlds (Foundry rewrites a LevelDB's LOG and MANIFEST on every open).
launched_since_trial() { [ -n "$(find "$data/worlds/$1" -type f -newer "$TRIAL/started" -print -quit 2>/dev/null)" ]; }
bytes_of() { # the bytes of every path given that exists (du -sb, as stage 11 counts them)
  local n=0 p
  for p in "$@"; do [ ! -e "$p" ] || n=$((n + $(du -sb "$p" | cut -f1))); done
  echo "$n"
}
same_fs() { [ "$(stat -c %d "$1")" = "$(stat -c %d "$2")" ]; }
# The copies must fit: what is left free after $3 more bytes on $1's filesystem stops the run under 5% of the disk
# and warns under 20% (the storage rule of stage 10).
check_room() { # $1 a path on the filesystem, $2 what to call it, $3 the bytes the run writes there
  local avail size left pct
  read -r avail size < <(df --output=avail,size -B1 "$1" | tail -n1)
  [ "${size:-0}" -gt 0 ] || die "cannot read the free space of $2. Nothing was changed"
  left=$((avail - $3))
  pct=$((left * 100 / size))
  if [ "$left" -lt $((size / 20)) ]; then
    die "not enough space on $2: $avail bytes free, the run writes $3, which would leave $pct% (under 5%). Nothing was changed"
  elif [ "$pct" -lt 20 ]; then
    warn "space gets low on $2: $pct% free after the run's $3 bytes (the rule is 20%); going on"
  else
    ok "$2: room for the run's $3 bytes ($pct% free after)"
  fi
}
# /join answers 200 even when no world runs (an error page), so look for the join form's template.
world_up() { curl -fs http://127.0.0.1:30000/join 2>/dev/null | grep -q 'id="join-game"'; }
status_field() { curl -fs http://127.0.0.1:30000/api/status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v).replace(/[^\w.+-]/g,"?").slice(0,40))}catch{}})' "$1"; }

stopped=0
was_foundry=0
was_gm_browser=0
# Stops the Assistant GM browser and Foundry, after checking nobody is online (the way stage 13 does it): with the
# browser gone, /api/status counts the people still in the world. An answer that cannot be read counts as unknown.
stop_services() {
  have_systemd || {
    warn "no systemd here (a test container?): nothing to stop"
    return 0
  }
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service && was_gm_browser=1
  say "stopping the Assistant GM browser and Foundry"
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  if [ "$was_foundry" = 1 ]; then
    local online="?"
    for _ in $(seq 1 10); do
      # The setup screen has no users field and counts as 0; an answer that is not JSON counts as unknown.
      online="$(curl -fs http://127.0.0.1:30000/api/status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).users;process.stdout.write(String(Number.isInteger(u)?u:0))}catch{process.stdout.write("?")}})')" || online="?"
      [ "$online" != 0 ] || break
      sleep 2
    done
    if [ "$online" != 0 ] && [ "$FORCE" != 1 ]; then
      [ "$was_gm_browser" = 0 ] || systemctl start foundry-ai-tool-gm-browser.service || true
      if [ "$online" = "?" ]; then
        die "cannot read who is online in Foundry (/api/status on port 30000): check it runs, or FORCE=1 to stop it anyway. Nothing was changed"
      fi
      die "$online user(s) are online in Foundry: run this when nobody plays (or FORCE=1). Nothing was changed"
    fi
    [ "$online" = 0 ] || warn "$online user(s) online or unknown; FORCE=1, stopping Foundry anyway"
  fi
  systemctl stop foundry.service
  stopped=1
}

# Launches world $1: options.json, Foundry, then the Assistant GM browser and a look at the bridge link.
start_on() {
  set_world "$1"
  ok "options.json launches ${1:-no world}"
  have_systemd || {
    warn "no systemd here (a test container?): Foundry and the Assistant GM browser were not started"
    return 0
  }
  systemctl restart foundry.service
  for _ in $(seq 1 60); do
    world_up && break
    sleep 2
  done
  world_up || die "$1 is not running on port 30000 (see: journalctl -u foundry -n 50)"
  ok "$1 is running"
  enable_unit foundry-ai-tool-gm-browser.service
  for _ in $(seq 1 45); do
    journalctl -u foundry-ai-tool-gm-browser --since '-3 min' --no-pager | grep -q 'joined world' && break
    sleep 2
  done
  journalctl -u foundry-ai-tool-gm-browser -n 5 --no-pager | grep 'assistant-gm' || true
  local linked=0
  for _ in $(seq 1 15); do
    if [ -n "$(ss -Htn state established '( sport = :31415 )' 2>/dev/null)" ]; then
      linked=1
      break
    fi
    sleep 2
  done
  if [ "$linked" = 1 ]; then
    ok "a Foundry connection is established on the bridge's port 31415"
  else
    warn "no established connection on the bridge's port 31415 yet; see: journalctl -u foundry-ai-tool-gm-browser -n 30"
  fi
  local reported
  reported="$(status_field systemVersion)"
  if [ "$reported" = "$(sys_version "$sysdir")" ]; then
    ok "Foundry reports $SYSTEM $reported"
  else
    warn "Foundry reports $SYSTEM '${reported:-?}', the folder holds $(sys_version "$sysdir")"
  fi
}

# A world folder back from a copy: the current one goes to $2 (kept), the copy is copied in (cp -a keeps owner and
# times, so the copy's files stay older than the trial marker).
# A rerun after a copy that died midway finds the cut-short folder in place: it goes next to the first one, numbered.
free_path() { # $1, or $1.2, $1.3 ... when it exists
  local p="$1" n=2
  while [ -e "$p" ]; do
    p="$1.$n"
    n=$((n + 1))
  done
  printf '%s' "$p"
}
restore_world() { # $1 world id, $2 the folder that takes the current copy, $3 the folder that holds the copy
  install -d -m 700 "$2"
  [ ! -d "$data/worlds/$1" ] || mv "$data/worlds/$1" "$(free_path "$2/$1")"
  cp -a "$3/$1" "$data/worlds/$1"
}

# dnd5e's data migration (see the header). Its own rule (dnd5e.mjs, _handleMigration): with the world's
# systemMigrationVersion (or else world.json flags.dnd5e.version) empty, or older than the new version's
# flags.needsMigrationVersion, the first GM client migrates the world and ends by setting systemMigrationVersion to
# the new version (an empty world gets that setting at once).
# The world's dnd5e.systemMigrationVersion: printed empty when unset, "?" when the database cannot be read. Read
# from a copy (opening a LevelDB writes to it, and Foundry holds the lock of a running world) with Foundry's own
# classic-level, as stage 11 does.
migration_of() { # $1 world id
  local db="$data/worlds/$1/data/settings" tmp v
  [ -d "$db" ] || return 0
  tmp="$(mktemp -d "$IMPORT/migration-check-XXXXXX")"
  if cp -a "$db" "$tmp/settings" 2>/dev/null; then
    rm -f "$tmp/settings/LOCK"
    v="$(node --input-type=module - "$FOUNDRY_APP/node_modules/classic-level" "$tmp/settings" <<'NODE' 2>/dev/null || echo '?'
import { createRequire } from 'node:module';
import path from 'node:path';
const [levelPath, db] = process.argv.slice(2);
const { ClassicLevel } = createRequire(path.join(levelPath, 'noop.js'))(levelPath);
const level = new ClassicLevel(db, { createIfMissing: false, valueEncoding: 'utf8' });
await level.open();
let found = '';
try {
  for await (const [, raw] of level.iterator()) {
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      continue;
    }
    if (doc?.key !== 'dnd5e.systemMigrationVersion' || doc.user) continue;
    let v = doc.value;
    try {
      v = JSON.parse(v);
    } catch {}
    found = String(v ?? '');
  }
} finally {
  await level.close();
}
process.stdout.write(found.replace(/[^\w.+-]/g, '?').slice(0, 40));
NODE
)"
  else
    v='?'
  fi
  rm -rf "${tmp:?}"
  printf '%s' "$v"
}
ver_newer() { # exit 0 when version $1 is newer than $2 (foundry.utils.isNewerVersion: numeric parts)
  node -e 'const a=String(process.argv[1]).split("."),b=String(process.argv[2]).split(".");for(let i=0;i<Math.max(a.length,b.length);i++){const x=Number(a[i]??0),y=Number(b[i]??0);if(x!==y)process.exit(x>y?0:1)}process.exit(1)' "$1" "$2"
}
# Prints "yes" when launching world $1 on the installed version starts a migration, "no" when it does not, "?"
# when its setting cannot be read. Called while the world is not running.
migration_due() { # $1 world id
  local cv needs
  cv="$(migration_of "$1")"
  if [ "$cv" = "?" ]; then
    echo "?"
    return 0
  fi
  [ -n "$cv" ] || cv="$(json_get "$data/worlds/$1/world.json" flags.dnd5e.version)"
  needs="$(json_get "$sysdir/system.json" flags.needsMigrationVersion)"
  if [ -z "$cv" ]; then
    echo yes
  elif [ -n "$needs" ] && ver_newer "$needs" "$cv"; then
    echo yes
  else
    echo no
  fi
}
# After start_on: waits until the dnd5e migration of world $1 (due: $2, from migration_due) has finished in the
# Assistant GM browser.
wait_for_migration() { # $1 world id, $2 yes|no|?
  local want v="" tries
  want="$(sys_version "$sysdir")"
  case "$2" in
    no)
      ok "$1 needs no $SYSTEM data migration for $want (needsMigrationVersion $(json_get "$sysdir/system.json" flags.needsMigrationVersion))"
      return 0
      ;;
    "?")
      warn "cannot read $1's dnd5e.systemMigrationVersion: wait until the Assistant GM browser shows no migration notice before you stop Foundry or take a snapshot"
      return 0
      ;;
  esac
  have_systemd || return 0
  say "waiting for the $SYSTEM data migration of $1 to $want (in the Assistant GM browser; up to $MIGRATION_WAIT s)"
  tries=$((MIGRATION_WAIT / 10))
  for _ in $(seq 1 "$tries"); do
    v="$(migration_of "$1")"
    [ "$v" != "$want" ] || break
    sleep 10
  done
  [ "$v" = "$want" ] || die "the $SYSTEM migration of $1 did not finish in $MIGRATION_WAIT s (its systemMigrationVersion is '${v:-unset}', not $want; see: journalctl -u foundry-ai-tool-gm-browser -n 50)"
  ok "$1 is migrated to $SYSTEM $want (systemMigrationVersion)"
}

# What a failed run puts back (set per mode below). Runs only after Foundry stopped.
undo=""
# The undo functions run with errexit off (on_exit calls them in an || list), so a step that failed does not stop
# the next one: before options.json launches a world again, the dnd5e folder must hold the version that world runs
# on. Otherwise options.json launches no world (a reboot shows the setup screen), Foundry and the Assistant GM
# browser stay stopped, and $3 says what to put back by hand.
relaunch_on() { # $1 the version world $2 runs on, $2 the world, $3 where the right version is
  local have
  have="$(sys_version "$sysdir")"
  if [ -n "$2" ] && [ "$have" != "$1" ]; then
    set_world "" || true
    was_foundry=0
    was_gm_browser=0
    warn "$sysdir holds ${have:-no readable $SYSTEM}, not $SYSTEM $1, so options.json launches no world and Foundry stays stopped. By hand: put $SYSTEM $1 back in $sysdir ($3), set options.json \"world\" to $2, then systemctl start foundry.service foundry-ai-tool-gm-browser.service"
    return 1
  fi
  set_world "$2"
}
undo_trial() {
  local failed="$IMPORT/prev-$stamp-failed-trial"
  if [ "$sys_swapped" = 1 ]; then
    rm -rf "${sysdir:?}"
    mv "$TRIAL/$SYSTEM-$from" "$sysdir" && warn "$SYSTEM $from is back in $sysdir"
  fi
  if [ "$kit_started" = 1 ]; then
    restore_world "$KIT" "$failed/worlds" "$TRIAL/worlds"
    warn "$KIT is back from the trial's copy (its run on $PIN_VERSION is in $failed/worlds)"
  fi
  if [ -d "$TRIAL" ]; then
    install -d -m 700 "$failed"
    mv "$TRIAL" "$failed/trial"
  fi
  relaunch_on "$from" "$launched_before" "it is $failed/trial/$SYSTEM-$from, or $TRIAL/$SYSTEM-$from if the trial folder did not move"
}
undo_switch() {
  local failed="$IMPORT/prev-$stamp-failed-switch"
  if [ "$campaign_started" = 1 ] && [ "$campaign_was_launched" = 0 ]; then
    restore_world "$CAMPAIGN" "$failed/worlds" "$TRIAL/worlds"
    warn "$CAMPAIGN is back from the trial's copy, still on $from data (the half-migrated one is in $failed/worlds)"
  fi
  state_set phase trial
  relaunch_on "$to" "$launched_before" "the trial installed it; see MODE=status"
}
undo_rollback() {
  # Past the system swap the old version should be in place. The world Foundry ran before the trial is safe to
  # launch on it unless it is itself waiting for its copy (it was launched during the trial): then Foundry stays
  # stopped. The rerun reads the list of worlds to reset from the state file, so this launch does not count as a
  # new one.
  if [ "$sys_swapped" = 1 ]; then
    local id waiting=0
    for id in "${restore[@]}"; do
      [ "$id" != "$launched_before" ] || [ -e "$TRIAL/restored-$id" ] || waiting=1
    done
    if [ "$(sys_version "$sysdir")" != "$from" ]; then
      set_world "" || true
      was_foundry=0
      was_gm_browser=0
      warn "the rollback stopped during the system swap: $sysdir does not hold $SYSTEM $from ($from is in $old, $to in $archive), so options.json launches no world and Foundry stays stopped; run MODE=rollback again to finish ($TRIAL, phase rolling-back)"
    elif [ "$waiting" = 1 ]; then
      set_world "" || true
      was_foundry=0
      was_gm_browser=0
      warn "the rollback stopped halfway: $SYSTEM $from is back, but $launched_before still waits for its copy, so Foundry stays stopped; run MODE=rollback again to finish ($TRIAL, phase rolling-back)"
    else
      set_world "$launched_before"
      warn "the rollback stopped halfway: $SYSTEM $from is back and Foundry launches $launched_before; run MODE=rollback again to finish ($TRIAL, phase rolling-back)"
    fi
  else
    warn "the rollback stopped before the system swap: nothing changed; run MODE=rollback again"
  fi
}
on_exit() {
  [ -z "$work" ] || rm -rf "${work:?}"
  [ "$stopped" = 1 ] && have_systemd || return 0
  [ -z "$undo" ] || "$undo" || warn "putting things back did not finish (see above)"
  world_now="$(get_world 2>/dev/null || echo '?')"
  if [ "$was_foundry" = 1 ]; then systemctl restart foundry.service || true; else systemctl stop foundry.service 2>/dev/null || true; fi
  if [ "$was_gm_browser" = 1 ]; then
    systemctl is-active --quiet foundry-ai-tool-gm-browser.service || systemctl start foundry-ai-tool-gm-browser.service || true
  fi
  if [ "$was_foundry" = 1 ]; then
    warn "the run did not finish: Foundry runs ${world_now:-no world} and the Assistant GM browser is back as it was"
  else
    warn "the run did not finish: Foundry is stopped (options.json launches ${world_now:-no world})"
  fi
}
trap on_exit EXIT
work=""
sys_swapped=0
kit_started=0
campaign_started=0
campaign_was_launched=0

phase="$(state_get phase)"
from="$(state_get from)"
to="$(state_get to)"
launched_before="$(state_get launched_before)"
installed="$(sys_version "$sysdir")"
foundry_version="$(json_get "$FOUNDRY_APP/package.json" version)"

# ---- status ------------------------------------------------------------------------------------------------
if [ "$MODE" = status ]; then
  say "system trial status"
  out "    Foundry ${foundry_version:-?}, $SYSTEM ${installed:-not installed} in $sysdir; options.json launches $(get_world)"
  if [ -d "$TRIAL" ]; then
    out "    trial: phase ${phase:-unknown}, $SYSTEM ${from:-?} to ${to:-?}, began $(state_get started), Foundry ran ${launched_before:-no world} before it"
  else
    out "    no trial open (pinned for the next one: $SYSTEM $PIN_VERSION)"
  fi
  for id in $(world_ids); do
    note=""
    if [ -f "$TRIAL/started" ]; then
      if launched_since_trial "$id"; then note=" (launched since the trial began)"; else note=" (not launched since the trial began)"; fi
    fi
    out "    world $id: $(json_get "$data/worlds/$id/world.json" system) $(json_get "$data/worlds/$id/world.json" systemVersion)$note"
  done
  trap - EXIT
  exit 0
fi

say "checking the request (MODE=$MODE)"
[ -n "$foundry_version" ] || die "cannot read Foundry's version from $FOUNDRY_APP/package.json. Nothing was changed"
# A rollback that stopped between its two moves left no dnd5e folder: its rerun finishes the swap.
[ -n "$installed" ] || { [ "$MODE" = rollback ] && [ "$phase" = rolling-back ] && [ ! -e "$sysdir" ]; } ||
  die "no $SYSTEM in $sysdir (no readable system.json). Nothing was changed"
[ -f "$data/worlds/$KIT/world.json" ] || die "the kit world $KIT is not installed (stage 11 makes it). Nothing was changed"
[ -f "$data/worlds/$CAMPAIGN/world.json" ] || die "the campaign $CAMPAIGN is not installed. Nothing was changed"

# ---- trial -------------------------------------------------------------------------------------------------
if [ "$MODE" = trial ]; then
  case "$phase" in
    "" | switched) ;;
    *) die "a trial is open ($TRIAL, phase $phase, $SYSTEM ${from:-?} to ${to:-?}): finish it with MODE=switch or MODE=rollback first. Nothing was changed" ;;
  esac
  [ -e "$TRIAL" ] && [ -z "$phase" ] && die "$TRIAL exists without a state file: look at it first (it is never removed by this stage). Nothing was changed"
  [ "$installed" != "$PIN_VERSION" ] || die "$SYSTEM $PIN_VERSION is installed already. Nothing was changed"
  ver_bound "$PIN_VERSION" "$installed" ge || die "$SYSTEM $PIN_VERSION is not newer than the installed $installed: a trial goes forward only. Nothing was changed"
  from="$installed"
  launched_before="$(get_world)"
  [ "$launched_before" != "$KIT" ] || die "Foundry launches $KIT already: launch the world it should go back to (curse-of-strahd) first. Nothing was changed"
  out "    $SYSTEM $from to $PIN_VERSION on Foundry $foundry_version; only $KIT is launched on $PIN_VERSION"
  out "    every world shares this one $SYSTEM folder:"
  for id in $(world_ids); do
    out "      $id ($(json_get "$data/worlds/$id/world.json" system) $(json_get "$data/worlds/$id/world.json" systemVersion))"
  done
  out "    launch no world but $KIT until MODE=switch or MODE=rollback (each other world would migrate to $PIN_VERSION)"

  say "the release zip (pinned sha256)"
  check_room "$IMPORT" "$IMPORT" 0
  if [ -n "$ZIP" ]; then
    zipf="$(realpath -e -- "$ZIP" 2>/dev/null)" || die "no such zip: $ZIP. Nothing was changed"
    case "$zipf" in "$IMPORT"/*.zip) ;; *) die "ZIP must be a .zip under $IMPORT/ (got $zipf). Nothing was changed" ;; esac
    [ -f "$zipf" ] || die "$zipf is not a regular file. Nothing was changed"
  else
    zipf="$IMPORT/$SYSTEM-release-$PIN_VERSION.zip"
    if [ -f "$zipf" ]; then
      ok "using the zip downloaded before ($zipf)"
    else
      curl -fsSL --retry 2 -o "$zipf.part" "$PIN_URL" || {
        rm -f "$zipf.part"
        die "the download from $PIN_URL failed. Nothing was changed"
      }
      mv "$zipf.part" "$zipf"
      ok "downloaded $zipf"
    fi
  fi
  got="$(sha256sum "$zipf" | cut -d' ' -f1)"
  if [ "$got" != "$PIN_SHA256" ]; then
    [ -n "$ZIP" ] || rm -f "$zipf"
    die "the zip's sha256 is $got, not the pinned $PIN_SHA256: damaged or not the release. Nothing was changed"
  fi
  ok "sha256 matches the pin"
  work="$IMPORT/work-$stamp"
  install -d -m 700 "$work"
  unzip -q "$zipf" -d "$work/new" || die "cannot unpack $zipf. Nothing was changed"
  src="$work/new"
  if [ ! -f "$src/system.json" ]; then
    tops="$(find "$src" -mindepth 1 -maxdepth 1)"
    [ "$(printf '%s\n' "$tops" | wc -l)" = 1 ] && [ -f "$tops/system.json" ] || die "the zip has no system.json at its top. Nothing was changed"
    src="$tops"
  fi
  [ "$(json_get "$src/system.json" id)" = "$SYSTEM" ] || die "the zip's system.json is not $SYSTEM. Nothing was changed"
  [ "$(sys_version "$src")" = "$PIN_VERSION" ] || die "the zip holds $SYSTEM $(sys_version "$src"), not $PIN_VERSION. Nothing was changed"
  min="$(json_get "$src/system.json" compatibility.minimum)"
  max="$(json_get "$src/system.json" compatibility.maximum)"
  [ -z "$min" ] || ver_bound "$foundry_version" "$min" ge || die "$SYSTEM $PIN_VERSION needs Foundry $min or newer; the Pi runs $foundry_version. Nothing was changed"
  [ -z "$max" ] || ver_bound "$foundry_version" "$max" le || die "$SYSTEM $PIN_VERSION supports Foundry up to $max; the Pi runs $foundry_version. Nothing was changed"
  ok "$SYSTEM $PIN_VERSION fits Foundry $foundry_version (minimum ${min:-none}, maximum ${max:-none})"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$src"
  find "$src" -type d -exec chmod 755 {} +
  find "$src" -type f -exec chmod 644 {} +
  # The copies of every world go to $TRIAL; across two filesystems the swaps copy too (the old version to $TRIAL,
  # the new one to $sysdir).
  paths=()
  for id in $(world_ids); do paths+=("$data/worlds/$id"); done
  if same_fs "$IMPORT" "$data"; then
    check_room "$IMPORT" "$IMPORT (and $data, the same filesystem)" "$(bytes_of "${paths[@]}")"
  else
    warn "$IMPORT and $data are on different filesystems: the swaps copy instead of renaming"
    check_room "$IMPORT" "$IMPORT" "$(bytes_of "${paths[@]}" "$sysdir")"
    check_room "$data" "$data" "$(bytes_of "$src")"
  fi

  stop_services
  undo=undo_trial
  if [ "$phase" = switched ]; then
    install -d -m 700 "$IMPORT/prev-$stamp-system-trial"
    mv "$TRIAL" "$IMPORT/prev-$stamp-system-trial/trial"
    ok "the last trial's folder (switched) moved to $IMPORT/prev-$stamp-system-trial/trial"
  fi
  say "keeping $SYSTEM $from and a copy of every world in $TRIAL"
  install -d -m 700 "$TRIAL" "$TRIAL/worlds"
  printf 'phase=installing\nsystem=%s\nfrom=%s\nto=%s\nlaunched_before=%s\nstarted=%s\n' \
    "$SYSTEM" "$from" "$PIN_VERSION" "$launched_before" "$stamp" >"$TRIAL/state"
  for id in $(world_ids); do cp -a "$data/worlds/$id" "$TRIAL/worlds/$id"; done
  : >"$TRIAL/started"
  ok "copied: $(world_ids | paste -sd' ' -)"
  mv "$sysdir" "$TRIAL/$SYSTEM-$from"
  sys_swapped=1
  mv "$src" "$sysdir"
  ok "$SYSTEM $PIN_VERSION installed; $from kept in $TRIAL/$SYSTEM-$from"
  kit_due="$(migration_due "$KIT")"

  say "Foundry launches $KIT on $SYSTEM $PIN_VERSION"
  kit_started=1
  start_on "$KIT"
  wait_for_migration "$KIT" "$kit_due"
  state_set phase trial
  undo=""
  stopped=0
  rm -rf "${work:?}"
  trap - EXIT
  say "summary"
  out "    $SYSTEM $PIN_VERSION runs; Foundry launches $KIT (the kit world); $from and the world copies are in $TRIAL"
  out "    next: run the test kit on $KIT, then MODE=switch (curse-of-strahd on $PIN_VERSION; a snapshot and its own OK)"
  out "    or MODE=rollback ($from back, $KIT reset from the copy, ${launched_before:-$CAMPAIGN} launched again)"
  out "    launch no other world until then (Return to Setup in Foundry would let anyone with the admin password do it)"
  [ -n "$ZIP" ] || out "    the zip stays in $zipf for a rerun; remove it later, only with the user's OK"
  exit 0
fi

# ---- switch ------------------------------------------------------------------------------------------------
if [ "$MODE" = switch ]; then
  case "$phase" in
    trial) ;;
    "") die "no trial is open: MODE=trial first. Nothing was changed" ;;
    switched) die "the trial of $SYSTEM $to was switched already. Nothing was changed" ;;
    *) die "the trial is in phase $phase, not trial: see MODE=status. Nothing was changed" ;;
  esac
  [ "$installed" = "$to" ] || die "the trial installed $SYSTEM $to but $installed is in $sysdir: see MODE=status. Nothing was changed"
  [ -d "$TRIAL/worlds/$CAMPAIGN" ] || die "the trial has no copy of $CAMPAIGN in $TRIAL/worlds. Nothing was changed"
  if launched_since_trial "$CAMPAIGN"; then
    campaign_was_launched=1
    warn "$CAMPAIGN was launched during the trial, so it may run on $to already; a failed switch leaves it as it is"
  fi
  launched_before="$(get_world)"
  others="$(world_ids | { grep -vxF -e "$KIT" -e "$CAMPAIGN" || true; } | paste -sd' ' -)"
  out "    $CAMPAIGN goes to $SYSTEM $to (it migrates on this launch); ${others:-no other world} migrate(s) when next launched"
  campaign_due="$(migration_due "$CAMPAIGN")"
  stop_services
  undo=undo_switch
  state_set phase switching
  say "Foundry launches $CAMPAIGN on $SYSTEM $to"
  campaign_started=1
  start_on "$CAMPAIGN"
  wait_for_migration "$CAMPAIGN" "$campaign_due"
  state_set phase switched
  state_set switched "$stamp"
  undo=""
  stopped=0
  trap - EXIT
  say "summary"
  out "    $CAMPAIGN runs on $SYSTEM $to; Foundry launches it again after a reboot"
  out "    $SYSTEM $from and the copies of every world from before the trial stay in $TRIAL; remove them later, only with the user's OK"
  out "    going back to $from now means restoring the snapshot from before this run"
  exit 0
fi

# ---- rollback ----------------------------------------------------------------------------------------------
case "$phase" in
  trial | rolling-back) ;;
  "") die "no trial is open: nothing to roll back. Nothing was changed" ;;
  switched) die "the trial was switched: $CAMPAIGN runs on $SYSTEM $to. Going back means restoring the snapshot from before the switch ($SYSTEM $from and the world copies are in $TRIAL). Nothing was changed" ;;
  *) die "the trial is in phase $phase: see MODE=status. Nothing was changed" ;;
esac
old="$TRIAL/$SYSTEM-$from"
if [ -d "$old" ]; then
  [ "$(sys_version "$old")" = "$from" ] || die "$old does not hold $SYSTEM $from. Nothing was changed"
  if [ -z "$installed" ]; then
    # A rollback that stopped between its two moves: $to went to the archive, $from is still in $TRIAL.
    [ -d "$(state_get archive)/$SYSTEM-$to" ] || die "$sysdir is missing and $SYSTEM $to is not in the rollback's archive ($(state_get archive)): see MODE=status. Nothing was changed"
    ok "finishing a rollback that stopped during the system swap ($SYSTEM $to is in $(state_get archive))"
  fi
else
  # A rollback that stopped after the system swap: the old version is in place already.
  [ "$phase" = rolling-back ] && [ "$installed" = "$from" ] || die "$old is missing and $sysdir holds $installed, not $from. Nothing was changed"
fi
[ -d "$TRIAL/worlds/$KIT" ] || die "the trial has no copy of $KIT in $TRIAL/worlds. Nothing was changed"
# Worlds besides the kit that were launched during the trial ran on the new version and may be migrated. A rerun
# after a rollback that stopped halfway takes the list the first run saved (its own launches since do not count).
restore=("$KIT")
saved_restore="$(state_get restore)"
if [ "$phase" = rolling-back ] && [ -n "$saved_restore" ]; then
  read -r -a restore <<<"$saved_restore"
  ok "finishing the rollback that stopped halfway; worlds to reset: ${restore[*]}"
else
  migrated=()
  created=()
  for id in $(world_ids); do
    [ "$id" != "$KIT" ] || continue
    if [ ! -d "$TRIAL/worlds/$id" ]; then
      created+=("$id")
    elif launched_since_trial "$id"; then
      migrated+=("$id")
    fi
  done
  if [ "${#migrated[@]}" -gt 0 ]; then
    [ "$RESTORE_MIGRATED" = 1 ] || die "launched during the trial, so they may be migrated to $to: ${migrated[*]}. RESTORE_MIGRATED=1 puts them back from the trial's copies too (their changes since $(state_get started) are lost; the current folders are kept in prev). Nothing was changed"
    restore+=("${migrated[@]}")
  fi
  [ "${#created[@]}" -eq 0 ] || warn "made during the trial, so there is no copy to put back: ${created[*]} (stays as it is; it may not open on $from)"
fi
for id in "${restore[@]}"; do
  [[ "$id" =~ ^[a-z0-9-]+$ ]] && [ -d "$TRIAL/worlds/$id" ] || die "no copy of '$id' in $TRIAL/worlds. Nothing was changed"
done
launched_before="${launched_before:-$CAMPAIGN}"
# A rerun keeps using the first run's archive, so everything the rollback kept stays in one folder.
archive="$(state_get archive)"
case "$phase:$archive" in
  rolling-back:"$IMPORT"/prev-*-system-trial) [ -d "$archive" ] || archive="$IMPORT/prev-$stamp-system-trial" ;;
  *) archive="$IMPORT/prev-$stamp-system-trial" ;;
esac
if [ -d "$old" ]; then
  out "    $SYSTEM ${installed:-$to (in the archive already)} to $from; reset from the trial's copies: ${restore[*]}; then Foundry launches $launched_before"
else
  out "    $SYSTEM $from is back already; reset from the trial's copies: ${restore[*]}; then Foundry launches $launched_before"
fi
# The trial's copies come back to $data; across two filesystems the current folders and the system swap copy too.
copies=()
current=()
for id in "${restore[@]}"; do
  [ -e "$TRIAL/restored-$id" ] && continue
  copies+=("$TRIAL/worlds/$id")
  current+=("$data/worlds/$id")
done
if same_fs "$IMPORT" "$data"; then
  check_room "$data" "$data" "$(bytes_of "${copies[@]}")"
else
  check_room "$data" "$data" "$(bytes_of "${copies[@]}" "$old")"
  check_room "$IMPORT" "$IMPORT" "$(bytes_of "${current[@]}" "$sysdir")"
fi
stop_services
undo=undo_rollback
state_set phase rolling-back
state_set restore "${restore[*]}"
state_set archive "$archive"
install -d -m 700 "$archive" "$archive/worlds"
if [ -d "$old" ]; then
  if [ -e "$sysdir" ]; then
    kept="$(free_path "$archive/$SYSTEM-$installed")"
    mv "$sysdir" "$kept"
  else
    kept="$archive/$SYSTEM-$to"
  fi
  # From here the dnd5e folder is not the trial's: a failure launches a world only once $from is in place.
  sys_swapped=1
  mv "$old" "$sysdir"
  ok "$SYSTEM $from is back; $to kept in $kept"
fi
sys_swapped=1
for id in "${restore[@]}"; do
  [ ! -e "$TRIAL/restored-$id" ] || continue
  restore_world "$id" "$archive/worlds" "$TRIAL/worlds"
  : >"$TRIAL/restored-$id"
  ok "$id reset from the trial's copy (the one that ran on $to is in $archive/worlds/$id)"
done
say "Foundry launches $launched_before on $SYSTEM $from"
start_on "$launched_before"
mv "$TRIAL" "$archive/trial"
undo=""
stopped=0
trap - EXIT
say "summary"
out "    $SYSTEM $from runs again; Foundry launches $launched_before"
out "    kept in $archive: $SYSTEM $to, the worlds that ran on it and the trial folder; remove later, only with the user's OK"
