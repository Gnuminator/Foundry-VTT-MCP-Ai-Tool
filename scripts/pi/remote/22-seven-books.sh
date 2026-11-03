#!/usr/bin/env bash
# Stage 22: trim the player-facing content to the seven kept books (the user, 2026-11-03: PHB 2024, DMG 2024, CoS,
# CoSCO, TCoE, XGtE, MotM), the same way every time. It is the checks in front of gm-script.sh, which runs a GM script
# in the running world as the Assistant GM (a dry run first, the same file for the real run). The scripts:
#   seven-books-trim.js          moves every other book's entry into the GM-only pack world.legacy-other-books (same
#                                ids; entries that kept ones link to stay), copies the SRD items and creatures that
#                                kept entries link to into two player-visible world packs and re-points the links,
#                                hides the dnd5e Item/Actor packs from Player and Trusted. A second run changes nothing.
#   seven-books-delete-legacy.js deletes the legacy pack for good (MODE=delete, only with the user's OK, see below).
# The compendium packs of the modules are shared by every world on this Foundry, so the trim runs in the one world
# that holds the legacy pack (WORLD, curse-of-strahd): that world must be the one running. Actor Studio's sources are
# set by stage 13 (player-creation-settings.mjs): run stage 13 after this one. Run this stage again after anything
# that puts the dropped books back: a stage 11 push of aitool-content, a content module update.
#
# Copy the GM scripts first, then pipe the stage together with gm-script.sh (the stage only checks and sets GM_SCRIPT
# and DRY_RUN for it; the order matters, lib.sh first):
#   scp scripts/pi/remote/seven-books-trim.js scripts/pi/remote/seven-books-delete-legacy.js foundry-pi:/root/
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/22-seven-books.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'bash -s'
# Env (in front of bash): WORLD (curse-of-strahd); MODE=trim (default) or delete; APPLY=1 for a real run (without it
# the stage does a dry run, which counts and prints and changes nothing); FORCE=1 overrides the players and recording
# checks (never the snapshot); for MODE=delete also DELETE_LEGACY=with-the-users-ok (the legacy pack holds the only
# copy of about 1500 entries on the Pi; the PC's content module and the snapshot are the way back).
# Take a snapshot first (/boot/dietpi/dietpi-backup 1) and get the user's OK before APPLY=1. Do the dry run first:
# gm-script.sh refuses a real run of a file without a passed dry run of the same sha256.

require_root
require_recent_snapshot

WORLD="${WORLD:-curse-of-strahd}"
MODE="${MODE:-trim}"
[[ "$WORLD" =~ ^[a-z0-9-]+$ ]] || die "'$WORLD' is not a valid world id (lowercase letters, digits, dashes). Nothing was changed"
case "$MODE" in
  trim) GM_SCRIPT="${GM_SCRIPT:-/root/seven-books-trim.js}" ;;
  delete)
    GM_SCRIPT="${GM_SCRIPT:-/root/seven-books-delete-legacy.js}"
    [ "${DELETE_LEGACY:-}" = with-the-users-ok ] || [ -z "${APPLY:-}" ] ||
      die "MODE=delete APPLY=1 deletes the legacy pack for good: put DELETE_LEGACY=with-the-users-ok in front of bash once the user has said yes. Nothing was changed"
    ;;
  *) die "MODE must be trim or delete (got '$MODE'). Nothing was changed" ;;
esac
case "$GM_SCRIPT" in /root/seven-books-*.js) ;; *) die "GM_SCRIPT must be /root/seven-books-trim.js or /root/seven-books-delete-legacy.js (got $GM_SCRIPT)" ;; esac
[ -f "$GM_SCRIPT" ] && [ ! -L "$GM_SCRIPT" ] || die "no $GM_SCRIPT: scp the GM scripts to /root/ first (see the header). Nothing was changed"
have_systemd || die "needs systemd (the Pi, not a test container). Nothing was changed"

# The world that is running must be WORLD: the module packs are shared, but the legacy pack and the pack ownership
# belong to the running world.
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first"
running="$(curl -fs --max-time 5 http://127.0.0.1:30000/api/status 2>/dev/null |
  "$NODE_DIR/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s).world;process.stdout.write(typeof w==="string"?w:"")}catch{}})' 2>/dev/null || true)"
[ -n "$running" ] || die "cannot read which world runs (/api/status on port 30000 has no world): start $WORLD first. Nothing was changed"
[ "$running" = "$WORLD" ] || die "world $running is running, not $WORLD: the trim must run in $WORLD (it holds the legacy pack). Nothing was changed"
ok "world $WORLD is running"

require_quiet "the seven-book trim"

if [ -z "${APPLY:-}" ]; then
  DRY_RUN=1
  say "dry run of $GM_SCRIPT (APPLY=1 for the real run)"
else
  DRY_RUN=""
  say "REAL run of $GM_SCRIPT in $WORLD"
fi
export GM_SCRIPT DRY_RUN
