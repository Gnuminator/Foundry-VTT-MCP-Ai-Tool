#!/usr/bin/env bash
# Switch the world the Pi's Foundry runs (backlog pi-world-switch; the user, 2026-11-02: no second Foundry instance, so
# tests move between worlds instead). Run from the PC by scripts/pi/switch-world.ps1 -World <id>, or by hand (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/switch-world.sh | ssh foundry-pi 'WORLD=frostmaiden-training bash -s'
# WORLD is one of curse-of-strahd (the campaign), frostmaiden-training and strahd-kit (the campaign's test copy). Nothing else.
#
# What it changes: the "world" line in options.json (so a reboot keeps the choice) and which services run. It never edits
# world data: no world folder is written, copied or removed by this stage. (Foundry itself may migrate a world's data when
# the world launches after the Foundry or dnd5e version changed; that is Foundry's own start-up work, not this stage's.)
#   1. checks, in this order, and stops before anything changes: WORLD is one of the three and its folder and world.json
#      exist (no link); no dnd5e system trial is open (lib.sh refuse_during_system_trial); no kit session runs (the kit GM
#      browser, or the state file of kit-session.sh); the foundry user can write options.json; the world that runs now
#      (Foundry's /api/status) and the one options.json launches are read and printed;
#   2. WORLD already the launched and running world: prints that and changes nothing (exit 0);
#   3. DRY_RUN=1 stops here and prints what it would do;
#   4. nobody online (lib.sh require_quiet: players, the Assistant GM browser not counted, and a Discord recording); FORCE=1
#      (the PC wrapper's -Force) only warns. A dietpi-backup snapshot from today is NOT required, because only the launch
#      choice changes; without one this prints a warning, and REQUIRE_SNAPSHOT=1 makes it a refusal;
#   5. stops the Assistant GM browser and Foundry, sets options.json to WORLD, starts Foundry and waits for the join page
#      of WORLD (and /api/status, when it names a world, must name WORLD);
#   6. starts the Assistant GM browser again (it was running, or enabled) and waits for "joined world WORLD" in its journal;
#      the bridge and the dashboard follow by themselves, because the Assistant GM browser carries the bridge link: it looks
#      for the established connection on port 31415 (a warning only).
# If Foundry does not come up on WORLD, options.json is put back to the world it launched before and Foundry and the
# Assistant GM browser start as they were (a dropped SSH connection, HUP and PIPE, is ignored once Foundry is stopped). If only
# the Assistant GM browser does not join, the switch stays and the stage exits 1 with the journal command to read: the
# Assistant GM user must exist in WORLD (stage 11 provisions it).
# Before and after: the stage prints "world before" and "world after" (running world, and the launch choice).
#
# Each use still needs the user's OK (pi-work). The Assistant GM browser carries the bridge link, so after a switch the
# Claude Desktop connectors, the dashboard and the Discord/session logs see WORLD, including strahd-kit: switch back to
# curse-of-strahd before game night, and never on a game-night day.
# Tests only: OPTIONS_FILE, WORLDS_DIR and FOUNDRY_URL point at stand-ins; KIT_STATE_FILE at the kit session's state file.

require_root

dry="${DRY_RUN:-0}"
world="${WORLD:-}"
options="${OPTIONS_FILE:-$FOUNDRY_DATA/Config/options.json}"
worlds_dir="${WORLDS_DIR:-$FOUNDRY_DATA/Data/worlds}"
base_url="${FOUNDRY_URL:-http://127.0.0.1:30000}"
kit_state="${KIT_STATE_FILE:-$TOOL_DATA/kit-session.env}"
gm_unit=foundry-ai-tool-gm-browser.service
node="$NODE_DIR/bin/node"

case "$world" in
curse-of-strahd | frostmaiden-training | strahd-kit) ;;
"") die "set WORLD to curse-of-strahd, frostmaiden-training or strahd-kit. Nothing was changed" ;;
*) die "WORLD '$world' is not one of curse-of-strahd, frostmaiden-training, strahd-kit. Nothing was changed" ;;
esac
dir="$worlds_dir/$world"
[ -d "$dir" ] && [ ! -L "$dir" ] || die "no world folder $dir (is $world installed? stage 11). Nothing was changed"
[ -f "$dir/world.json" ] && [ ! -L "$dir/world.json" ] || die "no $dir/world.json. Nothing was changed"
[ -x "$node" ] || die "no $node. Nothing was changed"
[ -f "$options" ] && [ ! -L "$options" ] || die "no $options. Nothing was changed"

if have_systemd; then
  refuse_during_system_trial "switch-world" "$world"
  ! systemctl is-active --quiet foundry-ai-tool-kit-gm-browser.service || die "a kit session is running (the kit GM browser): finish it first (kit-session.sh, MODE=down). Nothing was changed"
fi
[ ! -e "$kit_state" ] || die "a kit session is open ($kit_state): finish it first (kit-session.sh, MODE=down). Nothing was changed"
foundry_can_write "${options%/*}" || die "the $FOUNDRY_USER user cannot write in ${options%/*}, where options.json is changed. Nothing was changed"

# The launch choice, and the world that runs right now (empty when Foundry is down or on the setup screen).
launched() { "$node" -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o.world||""))}catch{}' "$options"; }
running() {
  curl -fs --max-time 5 "$base_url/api/status" 2>/dev/null |
    "$node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s).world;process.stdout.write(typeof w==="string"?w:"")}catch{}})' 2>/dev/null || true
}
# /join answers 200 even when no world runs, so look for the join form's template (as stage 11 does).
world_up() { curl -fs --max-time 5 "$base_url/join" 2>/dev/null | grep -q 'id="join-game"'; }

orig_world="$(launched)"
run_before="$(running)"
say "world before: running ${run_before:-none or not read from /api/status}, launch choice ${orig_world:-none}"

if [ "$orig_world" = "$world" ] && [ "$run_before" = "$world" ]; then
  say "$world already runs and is what Foundry launches: nothing to do"
  exit 0
fi

if [ "$dry" = 1 ]; then
  say "dry run: would stop the Assistant GM browser and Foundry, set options.json to $world, start Foundry, start the Assistant GM browser and wait for it to join $world; nothing changed"
  exit 0
fi

if [ "${REQUIRE_SNAPSHOT:-0}" = 1 ]; then
  require_recent_snapshot
elif ! (require_recent_snapshot) >/dev/null 2>&1; then
  warn "no dietpi-backup snapshot from today: only the launch choice changes here, so the run goes on (REQUIRE_SNAPSHOT=1 would refuse)"
fi
require_quiet "switching the world to $world"

was_foundry=0 was_gm=0 stopped=0 set_done=0
if have_systemd; then
  systemctl is-active --quiet foundry.service && was_foundry=1
  if systemctl is-active --quiet "$gm_unit" || systemctl is-enabled --quiet "$gm_unit" 2>/dev/null; then was_gm=1; fi
fi

restore() {
  [ "$stopped" = 1 ] || return 0
  warn "the switch did not finish: options.json is put back to '${orig_world:-no world}' and the services start again"
  systemctl stop foundry.service || true
  if [ "$set_done" = 1 ]; then foundry_edit_json "$options" 'o.world = a[0] || null' "$orig_world" || warn "could not put options.json back: set \"world\" to '$orig_world' in $options"; fi
  [ "$was_foundry" = 1 ] && { systemctl start foundry.service || true; }
  [ "$was_gm" = 1 ] && { systemctl start "$gm_unit" || true; }
  return 0
}
# A dropped SSH connection must not kill the stage while Foundry is stopped: the next line of output would raise SIGPIPE.
trap '' HUP PIPE
trap restore EXIT

if have_systemd; then
  say "stopping the Assistant GM browser and Foundry"
  stopped=1
  systemctl stop "$gm_unit" 2>/dev/null || true
  systemctl stop foundry.service
fi
foundry_edit_json "$options" 'o.world = a[0] || null' "$world"
set_done=1
[ "$(launched)" = "$world" ] || die "options.json does not name $world after the edit"
ok "options.json launches $world"

if ! have_systemd; then
  warn "no systemd here (a test container?): options.json is set, nothing was started"
  trap - EXIT
  exit 0
fi

say "starting Foundry on $world"
systemctl start foundry.service
up=0
for _ in $(seq 1 60); do
  if world_up; then up=1; break; fi
  sleep 2
done
[ "$up" = 1 ] || die "$world does not answer on $base_url (journalctl -u foundry -n 50); options.json is put back to '${orig_world:-no world}'"
now="$(running)"
if [ -n "$now" ] && [ "$now" != "$world" ]; then
  die "Foundry runs '$now', not $world; options.json is put back to '${orig_world:-no world}'"
fi
stopped=0
trap - EXIT
ok "Foundry runs ${now:-$world}"

joined=0
if [ "$was_gm" = 1 ]; then
  say "starting the Assistant GM browser"
  systemctl start "$gm_unit" || warn "the Assistant GM browser did not start: journalctl -u $gm_unit -n 50"
  for _ in $(seq 1 45); do
    id="$(systemctl show -p InvocationID --value "$gm_unit" 2>/dev/null || true)"
    # grep -c reads everything: with pipefail, grep -q could stop early and make journalctl's failed write fail the pipeline.
    if [ -n "$id" ] && [ "$(journalctl "_SYSTEMD_INVOCATION_ID=$id" --no-pager -o cat 2>/dev/null | grep -c "\[assistant-gm\] joined world $world " || true)" -gt 0 ]; then
      joined=1
      break
    fi
    sleep 2
  done
  if [ "$joined" = 1 ]; then
    ok "the Assistant GM browser joined $world"
  else
    journalctl -u "$gm_unit" -n 5 --no-pager 2>/dev/null | grep 'assistant-gm' || true
  fi
  linked=0
  for _ in $(seq 1 15); do
    if [ -n "$(ss -Htn state established '( sport = :31415 )' 2>/dev/null)" ]; then linked=1; break; fi
    sleep 2
  done
  if [ "$linked" = 1 ]; then ok "a Foundry connection is established on the bridge's port 31415"; else warn "no established connection on the bridge's port 31415 yet; see: journalctl -u $gm_unit -n 30"; fi
else
  warn "the Assistant GM browser was not running or enabled before: it is left stopped, so the bridge and the dashboard have no Foundry link"
fi

after_run="$(running)"
say "world after: running ${after_run:-not read from /api/status}, launch choice $(launched)"
if [ "$was_gm" = 1 ] && [ "$joined" != 1 ]; then
  die "the Assistant GM browser did not report 'joined world $world' in time. $world runs and options.json launches it; the bridge and the dashboard follow once the browser joins (journalctl -u $gm_unit -n 50; its login must exist in $world)"
fi
ok "done"
