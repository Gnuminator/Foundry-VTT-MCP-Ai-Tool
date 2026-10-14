#!/usr/bin/env bash
# Stage 15: SSH with keys only (D-123), before the Cloudflare tunnel (Part C) goes live. sshd on the Pi listens
# on every address; with password login and root login by password allowed, anyone who can reach port 22 can try
# to guess the root password. This stage writes a drop-in, /etc/ssh/sshd_config.d/00-foundry-keys-only.conf:
#   PasswordAuthentication no, KbdInteractiveAuthentication no, PermitRootLogin prohibit-password
# so root can still log in over SSH with a key (the PC's key; stage 9's command log keeps working), but not with
# a password. The root password is untouched: it still works at the console (a screen and keyboard on the Pi),
# which is the way back in if a key is ever lost. Stage number 14 belongs to another branch (pi-system-trial).
#
# What it does, in this order, and stops before the next step when one fails:
#   1. refuses unless root's authorized_keys holds at least one valid key (ssh-keygen -l reads it, also with the
#      command="..." prefix stage 9 adds), and unless the main sshd_config includes /etc/ssh/sshd_config.d
#      (without it a drop-in is ignored);
#   2. writes the drop-in (a copy of any older one is kept beside it), `sshd -t` checks the whole configuration;
#      when that fails the old drop-in comes back (or the new one goes) and the stage stops;
#   3. `sshd -T` shows what sshd will really use, for root; any of the three values different (an earlier file or a
#      Match block overrides it) rolls the drop-in back and the stage stops, naming the lines that win;
#   4. reloads ssh (a reload, not a restart: sessions that are open, including this one, stay up);
#   5. prints the effective values, and arms a 5-minute safety timer that removes the drop-in and reloads again
#      unless a NEW connection confirms (CONFIRM=1), the same net stage 9 uses.
# When the drop-in already has this content it only reloads again and prints the values (no new timer).
# It is safe to run again.
#
# An SSH settings change (the dangerous list): run it only after the user's OK and a dietpi-backup snapshot, in
# default permission mode, never on a game-night day. Run, then confirm from a NEW connection that logs in with the
# key only (no shared master, no password to fall back to), which cancels the timer:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/15-ssh-keys-only.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/15-ssh-keys-only.sh | ssh -o ControlPath=none -o PreferredAuthentications=publickey -o PasswordAuthentication=no foundry-pi 'CONFIRM=1 bash -s'
# If the new connection fails, wait 5 minutes (the timer puts the old settings back) or log in at the console with
# the root password. Undo later: the same pipe with 'UNDO=1 bash -s' (removes the drop-in, reloads ssh).

require_root
sshd_main=/etc/ssh/sshd_config
drop_dir=/etc/ssh/sshd_config.d
drop="$drop_dir/00-foundry-keys-only.conf"
keys=/root/.ssh/authorized_keys
revert_unit=foundry-ssh-keys-only-revert
# The values this stage sets, as `sshd -T` prints them (lower-case names).
want_t="passwordauthentication no
kbdinteractiveauthentication no
permitrootlogin without-password"

# Over a non-login ssh the sbin folders may not be on PATH.
PATH="$PATH:/usr/sbin:/sbin"
command -v sshd >/dev/null 2>&1 || die "sshd not found: is OpenSSH's server installed here?"
command -v ssh-keygen >/dev/null 2>&1 || die "ssh-keygen not found: is OpenSSH's client installed here?"

# The ssh service name: Debian and DietPi (OpenSSH) call it ssh, some systems sshd.
ssh_unit() {
  local u
  for u in ssh sshd; do
    if systemctl cat "$u.service" >/dev/null 2>&1; then
      printf '%s' "$u"
      return 0
    fi
  done
  return 1
}

# The effective settings for a root login from the local machine (Match blocks counted).
effective() {
  sshd -T -C user=root,host=localhost,addr=127.0.0.1 2>/dev/null
}

# The three values sshd will use, one per line, lower-case, in the order of $want_t.
current_values() {
  # OpenSSH before 10 prints prohibit-password as without-password (its old name); one spelling for the compare.
  effective | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' |
    sed 's/^permitrootlogin prohibit-password$/permitrootlogin without-password/' | sort -t' ' -k1,1 || true
}

# What would sshd say for the wanted values, sorted the same way.
want_sorted() {
  printf '%s\n' "$want_t" | sort -t' ' -k1,1
}

values_are_wanted() {
  [ "$(current_values)" = "$(want_sorted)" ]
}

# Print the three effective values.
show_values() {
  current_values | sed 's/^/    sshd -T: /'
}

reload_ssh() {
  if have_systemd; then
    local unit
    unit="$(ssh_unit)" || die "found no ssh or sshd service to reload"
    systemctl reload "$unit" || die "systemctl reload $unit failed; the drop-in is in place and the running sshd still has the old settings (a safety timer, if armed, takes the drop-in away); look at: journalctl -u $unit -n 30"
    sleep 1
    systemctl is-active --quiet "$unit" || die "$unit is not active after the reload; see: journalctl -u $unit -n 30"
    ok "$unit reloaded (a reload: open sessions stay up)"
  else
    warn "no systemd here (a test container?): configuration written and checked, ssh not reloaded"
  fi
}

# Lines in the SSH settings that decide the three values, for the message when something overrides ours.
show_winners() {
  grep -HniE '^[[:space:]]*(PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PermitRootLogin|Match)[[:space:]]' \
    "$sshd_main" "$drop_dir"/*.conf 2>/dev/null | sed 's/^/    /' >&2 || true
}

cancel_timer() {
  if have_systemd; then
    systemctl stop "$revert_unit.timer" 2>/dev/null || true
    systemctl reset-failed "$revert_unit.service" "$revert_unit.timer" 2>/dev/null || true
  fi
}

# ---- UNDO ---------------------------------------------------------------------------------------------------------
if [ "${UNDO:-}" = 1 ]; then
  say "undo: the SSH settings as they were before this stage"
  cancel_timer
  if [ -e "$drop" ]; then
    rm -f "${drop:?}"
    ok "removed $drop"
  else
    ok "$drop is not there"
  fi
  sshd -t || die "sshd -t fails without the drop-in: something else is wrong in the SSH settings; ssh was not reloaded"
  reload_ssh
  show_values
  exit 0
fi

# ---- CONFIRM ------------------------------------------------------------------------------------------------------
if [ "${CONFIRM:-}" = 1 ]; then
  say "confirm"
  [ -f "$drop" ] || die "$drop is not there: the safety timer already took it away, or the stage never ran; run it again, then confirm within 5 minutes"
  [ -n "${SSH_CONNECTION:-}" ] || warn "this does not look like an SSH session: confirm from a NEW connection that uses the key only"
  values_are_wanted || die "sshd does not use the wanted values any more; see: sshd -T"
  if have_systemd && systemctl list-timers --all --no-legend 2>/dev/null | grep -q "$revert_unit"; then
    systemctl stop "$revert_unit.timer"
    ok "revert timer cancelled: keys only stays"
  else
    ok "no revert timer armed (nothing to cancel)"
  fi
  show_values
  exit 0
fi

# ---- The checks that come before any change -----------------------------------------------------------------------
say "the keys"
[ -f "$keys" ] || die "$keys is missing: keys only would lock the SSH login out; nothing changed"
# ssh-keygen reads each line of an authorized_keys file, also with options in front (command="...").
key_count="$(ssh-keygen -l -f "$keys" 2>/dev/null | grep -cE '^[0-9]+ SHA256:' || true)"
[ "$key_count" -ge 1 ] || die "$keys holds no valid key: keys only would lock the SSH login out; nothing changed"
ok "$key_count key(s) in $keys"
if [ "$(passwd -S root 2>/dev/null | awk '{print $2}')" != P ]; then
  warn "root has no usable password (passwd -S root): the console login would not work as a way back in"
else
  ok "root has a password, so the console login stays as the way back in"
fi

say "the SSH configuration"
sshd -t || die "sshd -t already fails before any change: fix that first; nothing changed"
# Any uncommented Include whose path reaches the drop-in folder (/etc/ssh/sshd_config.d/*.conf).
grep -qE '^[[:space:]]*Include[[:space:]].*sshd_config\.d' "$sshd_main" ||
  die "$sshd_main has no Include line for $drop_dir: a drop-in would be ignored; nothing changed"
ok "$sshd_main includes $drop_dir"
mkdir -p "$drop_dir"

# ---- The drop-in --------------------------------------------------------------------------------------------------
say "the drop-in"
body="# Written by scripts/pi/remote/15-ssh-keys-only.sh (D-123); edit it there. SSH logs in with a key only: no
# password, root only with a key. The root password still works at the console. Undo: that script with UNDO=1.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password"
changed=0
backup="$drop.before"
if [ -f "$drop" ] && [ "$(cat "$drop")" = "$body" ]; then
  ok "$drop unchanged"
else
  changed=1
  had_old=0
  if [ -f "$drop" ]; then
    had_old=1
    cp -a "$drop" "$backup"
    ok "copy of the old drop-in: $backup"
  fi
  # Not named *.conf, so sshd does not read it before it is in place; one rename puts it there.
  new="$drop.new"
  printf '%s\n' "$body" >"$new"
  chmod 0644 "$new"
  mv -f "$new" "$drop"
  ok "wrote $drop"
  rollback() {
    if [ "$had_old" = 1 ]; then
      mv -f "$backup" "$drop"
      warn "the old drop-in is back in place"
    else
      rm -f "${drop:?}"
      warn "$drop removed again"
    fi
  }
  if ! sshd -t; then
    rollback
    die "sshd -t fails with the new drop-in; rolled back, ssh was not reloaded"
  fi
  ok "sshd -t passes"
fi

say "what sshd will use"
if ! values_are_wanted; then
  if [ "$changed" = 1 ]; then
    rollback
  fi
  warn "sshd would use these values for root (wanted: password no, kbd-interactive no, root without-password):"
  show_values >&2
  warn "settings that decide them (the first value sshd reads wins; an Include line high in $sshd_main reads $drop_dir first):"
  show_winners
  die "something overrides the drop-in; rolled back where it was changed, ssh was not reloaded"
fi
ok "the drop-in decides all three values"

if [ "$changed" = 0 ]; then
  # No new timer: nothing changed. A reload is harmless, and covers an earlier run that stopped before its reload.
  say "reload"
  reload_ssh
  show_values
  say "stage 15 done: SSH is keys only (the drop-in was already there)"
  exit 0
fi

# ---- Reload and the safety net -------------------------------------------------------------------------------------
say "reload"
if have_systemd; then
  # Armed before the reload so a connection that fails to come back is put right even if nobody is looking.
  cancel_timer
  if [ "${had_old:-0}" = 1 ]; then
    revert_cmd="/bin/mv -f $backup $drop"
  else
    revert_cmd="/bin/rm -f $drop"
  fi
  unit="$(ssh_unit)" || die "found no ssh or sshd service to reload"
  if ! systemd-run --quiet --unit="$revert_unit" --on-active=300 /bin/sh -c "$revert_cmd; /bin/systemctl reload $unit"; then
    rollback
    die "could not arm the safety timer; rolled back, ssh was not reloaded"
  fi
  ok "safety net: the old SSH settings come back in 5 minutes unless a new connection confirms (CONFIRM=1)"
else
  warn "no systemd here (a test container?): no safety timer"
fi
reload_ssh
show_values
say "stage 15 done: confirm from a NEW key-only connection within 5 minutes (CONFIRM=1, see the header); the console login with the root password is the way back in"
