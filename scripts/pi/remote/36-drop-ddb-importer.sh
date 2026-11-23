#!/usr/bin/env bash
# Stage 36: switch DDB Importer (module id ddb-importer) off in the live world (backlog drop-ddb-importer; the user, 2026-11-20:
# everything is imported from D&D Beyond, no more imports are planned, and its proxy fails on dnd5e 6.1.1). The 2026-11-23
# read-only look at the Pi found the module's files in /var/lib/foundry/Data/modules/ddb-importer, the module switched on in the
# curse-of-strahd world, and nothing listening on port 31517: the DDB proxy only ever ran on the user's PC.
#
# What it changes, nothing else:
#   1. a headless Chromium joins the live world as its GM (the login in $TOOL_ETC/world-<WORLD>.env, the way stage 11's world
#      switches do) and sets the module's entry in Foundry's `core.moduleConfiguration` to false, then reloads and reads the entry
#      back from the server (scripts/pi/remote/module-switch.mjs, copied to /root first, see below). Every other module's entry is
#      left as it is.
#   2. nothing else. The module's files stay in Data/modules (switched off, a reinstall is not needed to bring it back: UNDO=1
#      switches it on again). Nothing is deleted, no unit is started, stopped or restarted, so Foundry and the bridge keep running.
# The proxy: this stage only looks. There is no ddb-proxy unit, container or file on the Pi, so there is nothing to stop. When a
# listener on port 31517 is found anyway, the stage names it and goes on; it never kills a process (that would be a separate OK).
# The Assistant GM browser keeps the module loaded in memory until its next reload (the next Foundry or GM-browser restart, for
# example the nightly backup); the setting itself is stored at once, so a new login no longer loads the module.
#
# Needs the world running with nobody online (the stage joins as the GM, which players would see, and a world setting changes under them)
# and no recording. A real run and UNDO need a dietpi-backup snapshot from today and the user's OK. Never on a game night.
#
# Modes (environment, before bash):
#   (none)     a dry run: the checks only, joins nothing, changes nothing, needs no snapshot
#   CHECK=1    joins as the GM and prints the module's state (installed, active, configured); changes no setting. Its only
#              write is the driver file copied into $TOOL_DIR/gm-browser (the same copy a real run uses)
#   APPLY=1    switch the module off and read it back
#   UNDO=1     switch the module on again and read it back
# Env: WORLD (default curse-of-strahd; the world that must be running), MODULE_ID (default ddb-importer), FORCE=1 (players and
# recording check only, never the snapshot). These lines are bash:
#   scp scripts/pi/remote/module-switch.mjs foundry-pi:/root/                                          (from the merge commit)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/36-drop-ddb-importer.sh | ssh foundry-pi 'bash -s'            a dry run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/36-drop-ddb-importer.sh | ssh foundry-pi 'CHECK=1 bash -s'    read the state
#   /boot/dietpi/dietpi-backup 1                                                                       (then the user's OK)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/36-drop-ddb-importer.sh | ssh foundry-pi 'APPLY=1 bash -s'    the real run
# Tests only: SRC_DRIVER (default /root/module-switch.mjs).

WORLD="${WORLD:-curse-of-strahd}"
MODULE_ID="${MODULE_ID:-ddb-importer}"
CHECK="${CHECK:-}"
APPLY="${APPLY:-}"
UNDO="${UNDO:-}"
SRC_DRIVER="${SRC_DRIVER:-/root/module-switch.mjs}"
DRIVER="$TOOL_DIR/gm-browser/module-switch.mjs"
data="$FOUNDRY_DATA/Data"
envf="$TOOL_ETC/world-$WORLD.env"

require_root
for v in CHECK APPLY UNDO; do
  case "${!v}" in "" | 1) ;; *) die "$v must be 1 or left out (got '${!v}'). Nothing was changed" ;; esac
done
modes=0
for v in "$CHECK" "$APPLY" "$UNDO"; do [ "$v" = 1 ] && modes=$((modes + 1)); done
[ "$modes" -le 1 ] || die "use one of CHECK=1, APPLY=1 and UNDO=1, not several. Nothing was changed"
[[ "$WORLD" =~ ^[a-z0-9][a-z0-9_-]{0,60}$ ]] || die "WORLD '$WORLD' is not a world id. Nothing was changed"
[[ "$MODULE_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$ ]] || die "MODULE_ID '$MODULE_ID' is not a module id. Nothing was changed"
[ -d "$data/modules" ] || die "no $data/modules: Foundry has not run here yet (stage 3). Nothing was changed"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first. Nothing was changed"

if [ -n "$APPLY" ]; then mode=off; elif [ -n "$UNDO" ]; then mode=on; else mode=read; fi
if [ -n "$APPLY$UNDO" ]; then run_word="real run (module $mode)"; elif [ -n "$CHECK" ]; then run_word="check"; else run_word="dry run"; fi
say "stage 36: $MODULE_ID in $WORLD, $run_word"

# ---- read-only: what is on the Pi ----------------------------------------------------------------------------------------------------
if [ -d "$data/modules/$MODULE_ID" ]; then
  ok "the module's files are in $data/modules/$MODULE_ID (they stay there)"
else
  warn "no $data/modules/$MODULE_ID: the module is not installed here, so there is nothing to switch"
fi
if ! command -v ss >/dev/null 2>&1; then
  warn "ss is not installed: cannot tell whether something listens on port 31517"
  listener=""
else
  listener="$(ss -ltnH 2>/dev/null | awk '$4 ~ /:31517$/ {print $4}' | head -n1)" || listener=""
fi
if [ -n "$listener" ]; then
  warn "something listens on $listener (port 31517, the DDB proxy's port). This stage never stops a process: find it with 'ss -ltnp | grep 31517' and bring it to the user"
else
  ok "nothing listens on port 31517: there is no DDB proxy to stop on this Pi"
fi
[ -f "$envf" ] || die "no $envf (the GM login of $WORLD). Nothing was changed"
[ -f "$DRIVER" ] || [ -f "$SRC_DRIVER" ] || die "no $SRC_DRIVER and no $DRIVER: scp scripts/pi/remote/module-switch.mjs foundry-pi:/root/ first. Nothing was changed"

# /join answers 200 even when no world runs, so look for the join form's template (as stage 11 does).
join_page="$(curl -fs --max-time 10 http://127.0.0.1:30000/join 2>/dev/null)" || join_page=""
[[ "$join_page" == *'id="join-game"'* ]] ||
  die "no world is running on port 30000. Nothing was changed"
ok "a world is running on port 30000"

if [ -n "$APPLY$UNDO" ]; then
  require_recent_snapshot
  if [ "${FORCE:-0}" != 1 ]; then require_quiet "stage 36 (it joins the world as the GM and changes a module setting)"; fi
elif [ -z "$CHECK" ]; then
  ok "dry run: nothing joined, nothing changed. CHECK=1 reads the module's state from the live world; APPLY=1 switches it off (snapshot and the user's OK first)"
  exit 0
fi

trap '' HUP PIPE # a dropped SSH session must not cut the run between the write and the read-back

# ---- the in-browser part -------------------------------------------------------------------------------------------------------------
if [ -f "$SRC_DRIVER" ]; then
  install -d -m 755 "$TOOL_DIR/gm-browser"
  install -m 0644 "$SRC_DRIVER" "$DRIVER"
  ok "installed $DRIVER"
  [ -z "$APPLY$UNDO" ] || rm -f "${SRC_DRIVER:?}"
fi
[ -f "$DRIVER" ] || die "no $DRIVER. Nothing was changed"
say "joining $WORLD as the GM ($mode)"
(
  set -a
  # shellcheck disable=SC1090
  . "$envf"
  set +a
  [ -n "${GM_USER:-}" ] && [ -n "${GM_PASSWORD:-}" ] || {
    out "ERROR: $envf has no GM_USER and GM_PASSWORD" 1
    exit 1
  }
  # The login stays in the environment (exported by set -a above), never on a command line: runuser stays as the parent.
  runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" TOOL_APP="$TOOL_DIR/app" \
    FOUNDRY_URL=http://127.0.0.1:30000 CHROMIUM=/usr/bin/chromium \
    WORLD="$WORLD" MODULE_ID="$MODULE_ID" MODE="$mode" \
    "$NODE_DIR/bin/node" "$DRIVER"
) || die "the module switch failed or did not verify (see the lines above). The setting may be half done: run CHECK=1 to read it, or the same mode again (a second run changes nothing that is already right)"

case "$mode" in
  off) ok "$MODULE_ID is switched off in $WORLD and read back; its files are untouched. UNDO=1 switches it on again" ;;
  on) ok "$MODULE_ID is switched on in $WORLD and read back" ;;
  read) ok "state read (CHECK=1 changed no setting)" ;;
esac
