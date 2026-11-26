#!/usr/bin/env bash
# Stage 37: set world switches in the live world from the Pi, with no world bundle (backlog stage11-clean-world-route). Stage 11
# needs a bundle from push-world.ps1 even to set one setting, and push-world refuses the PC copy of curse-of-strahd (the Pi is
# the truth for that world, and the PC copy's racooze-map-library map files lie outside the bundle roots, so the two copies differ). This stage skips all of
# that: it joins the running world as its GM and sets the switches through Foundry's settings API, with the same driver stage 11
# uses (scripts/pi/remote/world-switches.mjs, SWITCH_ONLY narrows it to the named entries).
#
# What it changes, nothing else: the named world settings (default only item-piles.enableTrading, so Request Trade works).
# The world's files, modules, bundle folders and units are not touched; no unit is started, stopped or restarted.
#
# Needs the world running with nobody online (the stage joins as the GM, which players would see) and no recording. A real run
# needs a dietpi-backup snapshot from today and the user's OK. Never on a game night.
#
# Modes (environment, before bash):
#   (none)     a dry run: the checks only, joins nothing, changes nothing, needs no snapshot
#   CHECK=1    joins as the GM and prints the named switches as they are; sets nothing. Its only write is the driver file
#              copied into $TOOL_DIR/gm-browser
#   APPLY=1    sets the named switches, reloads and reads them back
# Env: WORLD (default curse-of-strahd), SWITCHES (comma separated <namespace>.<key>, default item-piles.enableTrading; the names
# must be entries of world-switches.mjs), FORCE=1 (players and recording check only, never the snapshot). These lines are bash:
#   scp scripts/pi/remote/world-switches.mjs foundry-pi:/root/                                          (from the merge commit)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/37-world-switches.sh | ssh foundry-pi 'bash -s'            a dry run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/37-world-switches.sh | ssh foundry-pi 'CHECK=1 bash -s'    read the switches
#   /boot/dietpi/dietpi-backup 1                                                                       (then the user's OK)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/37-world-switches.sh | ssh foundry-pi 'APPLY=1 bash -s'    the real run
# Tests only: SRC_DRIVER (default /root/world-switches.mjs).

WORLD="${WORLD:-curse-of-strahd}"
SWITCHES="${SWITCHES:-item-piles.enableTrading}"
CHECK="${CHECK:-}"
APPLY="${APPLY:-}"
SRC_DRIVER="${SRC_DRIVER:-/root/world-switches.mjs}"
DRIVER="$TOOL_DIR/gm-browser/world-switches.mjs"
data="$FOUNDRY_DATA/Data"
envf="$TOOL_ETC/world-$WORLD.env"

require_root
for v in CHECK APPLY; do
  case "${!v}" in "" | 1) ;; *) die "$v must be 1 or left out (got '${!v}'). Nothing was changed" ;; esac
done
[ -z "$CHECK" ] || [ -z "$APPLY" ] || die "use CHECK=1 or APPLY=1, not both. Nothing was changed"
[[ "$WORLD" =~ ^[a-z0-9][a-z0-9_-]{0,60}$ ]] || die "WORLD '$WORLD' is not a world id. Nothing was changed"
[[ "$SWITCHES" =~ ^[A-Za-z0-9][A-Za-z0-9_.,-]{0,300}$ ]] || die "SWITCHES '$SWITCHES' is not a comma separated list of <namespace>.<key> names. Nothing was changed"
[ -d "$data/worlds/$WORLD" ] || die "no world $WORLD under $data/worlds. Nothing was changed"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first. Nothing was changed"

if [ -n "$APPLY" ]; then run_word="real run"; elif [ -n "$CHECK" ]; then run_word="check"; else run_word="dry run"; fi
say "stage 37: switches $SWITCHES in $WORLD, $run_word"

[ -f "$envf" ] || die "no $envf (the GM login of $WORLD). Nothing was changed"
[ -f "$DRIVER" ] || [ -f "$SRC_DRIVER" ] || die "no $SRC_DRIVER and no $DRIVER: scp scripts/pi/remote/world-switches.mjs foundry-pi:/root/ first. Nothing was changed"

# /join answers 200 even when no world runs, so look for the join form's template (as stage 11 does).
join_page="$(curl -fs --max-time 10 http://127.0.0.1:30000/join 2>/dev/null)" || join_page=""
[[ "$join_page" == *'id="join-game"'* ]] ||
  die "no world is running on port 30000. Nothing was changed"
ok "a world is running on port 30000"

if [ -n "$APPLY" ]; then
  require_recent_snapshot
fi
if [ -n "$APPLY$CHECK" ]; then
  if [ "${FORCE:-0}" != 1 ]; then require_quiet "stage 37 (it joins the world as the GM)"; fi
else
  ok "dry run: nothing joined, nothing changed. CHECK=1 reads the switches from the live world; APPLY=1 sets them (snapshot and the user's OK first)"
  exit 0
fi

trap '' HUP PIPE # a dropped SSH session must not cut the run between the write and the read-back

# ---- the in-browser part -------------------------------------------------------------------------------------------------------------
if [ -f "$SRC_DRIVER" ]; then
  install -d -m 755 "$TOOL_DIR/gm-browser"
  install -m 0644 "$SRC_DRIVER" "$DRIVER"
  ok "installed $DRIVER"
  [ -z "$APPLY" ] || rm -f "${SRC_DRIVER:?}"
fi
[ -f "$DRIVER" ] || die "no $DRIVER. Nothing was changed"
if [ -n "$APPLY" ]; then read_only=0; else read_only=1; fi
say "joining $WORLD as the GM"
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
    WORLD="$WORLD" SWITCH_ONLY="$SWITCHES" SWITCH_READ_ONLY="$read_only" \
    "$NODE_DIR/bin/node" "$DRIVER"
) || die "the world switches failed or did not verify (see the lines above). They may be half set: run CHECK=1 to read them, or APPLY=1 again (a second run changes nothing that is already right)"

if [ -n "$APPLY" ]; then
  ok "$SWITCHES set in $WORLD and read back"
else
  ok "switches read (CHECK=1 set nothing)"
fi
