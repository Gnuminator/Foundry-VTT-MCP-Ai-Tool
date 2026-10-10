#!/usr/bin/env bash
# Read-only check (#273, #308 review): Foundry's administrator password, and the Gamemaster and Assistant GM
# users with no password in every world on the Pi (or a world with no Gamemaster at all). Stage 12 runs the
# same checks (lib-gm-passwords.sh) and refuses to open the tunnel while one fails. Run this again after
# adding or resetting a world or adding a GM user once the tunnel is open (stage 12 only checks when it runs).
# It changes nothing: admin.txt is only tested for being there, and each world's users database is copied to
# a root-only folder in /tmp, read there and removed. Foundry may keep running. It prints world ids, user
# names and roles, never a password hash.
# Claude runs:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/lib-gm-passwords.sh scripts/pi/remote/gm-passwords.sh | ssh foundry-pi 'bash -s'
# Exit 0: all set. Exit 3: something found (set a password in that world: Game Settings, User Management,
# as that world's Gamemaster; or Setup, Configuration, Administrator Password). Exit 1: a world could not be
# read, or there is no worlds folder.

require_root
declare -F gm_password_check >/dev/null || die "gm_password_check is missing: pipe lib-gm-passwords.sh after lib.sh (see the header). Nothing was changed"

say "Foundry's administrator password"
admin_rc=0
if admin_password_set; then ok "set"; else
  printf '    FOUND: no administrator password (%s is missing or empty): /setup is open to anyone who reaches Foundry\n' "$FOUNDRY_DATA/Config/admin.txt"
  admin_rc=3
fi
say "GM users with no password, in every world in $FOUNDRY_DATA/Data/worlds"
rc=0
gm_password_check || rc=$?
case "$rc" in
  0) say "none: every world's Gamemaster and Assistant GM users have a password" ;;
  3) say "found: set a password for each user listed above (in that world: Game Settings, User Management) before stage 12 opens the tunnel" ;;
  *) say "the check could not read every world (see the errors above)" ;;
esac
[ "$rc" != 0 ] || rc=$admin_rc
exit "$rc"
