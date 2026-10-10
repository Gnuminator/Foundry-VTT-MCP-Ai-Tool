#!/usr/bin/env bash
# Read-only check (#273): the Gamemaster and Assistant GM users with no password, in every world on the Pi.
# Stage 12 runs the same check (gm_password_check in lib.sh) and refuses to open the tunnel while it finds one.
# It changes nothing: each world's users database is copied to a root-only folder in /tmp, read there and
# removed. Foundry may keep running. It prints world ids, user names and roles, never a password hash.
# Claude runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-passwords.sh | ssh foundry-pi 'bash -s'
# Exit 0: none found. Exit 3: one or more found (set a password in that world: Game Settings, User
# Management, as that world's Gamemaster). Exit 1: a world could not be read.

require_root

say "GM users with no password, in every world in $FOUNDRY_DATA/Data/worlds"
rc=0
gm_password_check || rc=$?
case "$rc" in
  0) say "none: every world's Gamemaster and Assistant GM users have a password" ;;
  3) say "found: set a password for each user listed above (in that world: Game Settings, User Management) before stage 12 opens the tunnel" ;;
  *) say "the check could not read every world (see the errors above)" ;;
esac
exit "$rc"
