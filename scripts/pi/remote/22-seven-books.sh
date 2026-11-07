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
# Env (in front of bash): WORLD (curse-of-strahd); MODE=trim (default), check (read-only: fails when the world no
# longer matches the trim; run it after a stage 11 push or a content module update, no OK needed) or delete; APPLY=1 for a real run (without it
# the stage does a dry run, which counts and prints and changes nothing; any other APPLY value is refused); FORCE=1
# overrides the players and recording checks (never the snapshot); OTHER_WORLDS_OK=1 for a real trim while other
# worlds exist on this Foundry (they share the edited module packs: the moved entries are gone there, the re-pointed
# links are dead, the dnd5e packs stay visible and strahd-kit does not show the trimmed view); for
# MODE=delete also DELETE_LEGACY=with-the-users-ok (the legacy pack holds the only copy of about 1500 entries on the
# Pi; the PC's content module and the snapshot are the way back). A GM_SCRIPT in the environment is ignored: the
# script follows MODE.
# Take a snapshot first (/boot/dietpi/dietpi-backup 1) and get the user's OK before APPLY=1. Do the dry run first:
# gm-script.sh refuses a real run of a file without a passed dry run of the same sha256.

require_root
trap '' HUP PIPE # a dropped ssh (HUP, closed pipe) must not kill the stage halfway through a step
[ "${MODE:-trim}" = check ] || require_recent_snapshot # the drift check only reads

WORLD="${WORLD:-curse-of-strahd}"
MODE="${MODE:-trim}"
[[ "$WORLD" =~ ^[a-z0-9-]+$ ]] || die "'$WORLD' is not a valid world id (lowercase letters, digits, dashes). Nothing was changed"
# APPLY is exactly 1 for a real run; any other value (APPLY=0, APPLY=no) is refused, never taken for a real run.
case "${APPLY:-}" in "" | 1) ;; *) die "APPLY must be 1 or left out (got '${APPLY}'). Nothing was changed" ;; esac
# GM_SCRIPT comes from MODE alone (a GM_SCRIPT in the environment is ignored), so the delete script never runs without
# the DELETE_LEGACY check below.
unset GM_SCRIPT
case "$MODE" in
  trim) GM_SCRIPT=/root/seven-books-trim.js ;;
  delete)
    GM_SCRIPT=/root/seven-books-delete-legacy.js
    [ "${DELETE_LEGACY:-}" = with-the-users-ok ] || [ -z "${APPLY:-}" ] ||
      die "MODE=delete APPLY=1 deletes the legacy pack for good: put DELETE_LEGACY=with-the-users-ok in front of bash once the user has said yes. Nothing was changed"
    ;;
  check)
    # Read-only drift check: the trim script with CHECK_ONLY in front, always a dry run; it fails when the world no
    # longer matches what the trim leaves (a stage 11 push or a content module update put books back). Needs no OK.
    [ -z "${APPLY:-}" ] || die "MODE=check only reads and takes no APPLY. Nothing was changed"
    [ -f /root/seven-books-trim.js ] && [ ! -L /root/seven-books-trim.js ] ||
      die "no /root/seven-books-trim.js: scp the GM scripts to /root/ first (see the header). Nothing was changed"
    GM_SCRIPT=/root/seven-books-check.js
    { printf 'const CHECK_ONLY = true;\n'; cat /root/seven-books-trim.js; } >"$GM_SCRIPT.new" &&
      mv -f -- "$GM_SCRIPT.new" "$GM_SCRIPT" ||
      die "could not write $GM_SCRIPT. Nothing was changed"
    ;;
  *) die "MODE must be trim, check or delete (got '$MODE'). Nothing was changed" ;;
esac
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

# The trim edits module packs, and every world on this Foundry shares those packs: the moved entries are gone in the
# other worlds (kept only in $WORLD's legacy pack), the re-pointed links reach world packs that exist only in $WORLD, and
# the hiding of the dnd5e packs is per world, so the other worlds do not get the trimmed view.
if [ "$MODE" = trim ]; then
  others="$(find "$FOUNDRY_DATA/Data/worlds" -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null | tr ' ' '\n' | grep -vx "$WORLD" | tr '\n' ' ' || true)"
  if [ -n "${others// /}" ]; then
    if [ -n "${APPLY:-}" ] && [ "${OTHER_WORLDS_OK:-}" != 1 ]; then
      die "other worlds (${others% }) share the module packs this trim edits: in them the moved entries are gone (kept only in $WORLD's legacy pack), the PHB 2024 links to SRD items and creatures point at world packs that exist only in $WORLD, and the dnd5e packs stay visible (so strahd-kit does not show the trimmed view). Put OTHER_WORLDS_OK=1 in front of bash once the user accepts that. Nothing was changed"
    fi
    warn "other worlds (${others% }) share the edited module packs; the moved entries are gone there and the re-pointed links will not resolve"
  fi
fi

require_quiet "the seven-book trim"

if [ -z "${APPLY:-}" ]; then
  DRY_RUN=1
  say "dry run of $GM_SCRIPT (APPLY=1 for the real run)"
else
  DRY_RUN=""
  say "REAL run of $GM_SCRIPT in $WORLD"
fi
export GM_SCRIPT DRY_RUN
