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
#      command="..." prefix stage 9 adds), sshd accepts keys from that file (PubkeyAuthentication,
#      AuthorizedKeysFile, AuthenticationMethods), the main sshd_config includes /etc/ssh/sshd_config.d (without it
#      a drop-in is ignored), no Match block sets one of these values, ssh is not socket-activated, and the ssh
#      service can be found;
#   2. writes the drop-in (a copy of any older one is kept beside it), `sshd -t` checks the whole configuration;
#      when that fails the old drop-in comes back (or the new one goes) and the stage stops;
#   3. `sshd -T` shows what sshd will really use, for root from the machine itself and from a LAN and a public
#      address; any of the three values different (an earlier file overrides it) rolls the drop-in back and the
#      stage stops, naming the lines that win;
#   4. arms a 5-minute safety timer that puts the old settings back (and starts ssh if it is down) unless a NEW
#      connection confirms (CONFIRM=1), the same net stage 9 uses;
#   5. reloads ssh (a reload, not a restart: sessions that are open, including this one, stay up; when ssh is not
#      active afterwards the old drop-in comes back and the service is started), asks the running sshd what it
#      offers a client without a key (a "live:" line), and prints the effective values.
# A run with the drop-in already in place (the same content) reloads again and looks at the safety net: a timer from
# an earlier run that is still armed is left armed (CONFIRM=1 is still needed); with no timer and no confirmation
# (the earlier run stopped, or the Pi rebooted) a new timer is armed first; after CONFIRM=1 it only reloads.
# It is safe to run again.
#
# An SSH settings change (the dangerous list): run it only after the user's OK and a dietpi-backup snapshot, in
# default permission mode, never on a game-night day. Run, then confirm from a NEW connection that logs in with the
# key only (no shared master, no password to fall back to), which cancels the timer. These lines are bash (Git Bash,
# or Claude's Bash tool), not PowerShell: PowerShell's `cat` takes one file and adds CRLF line endings.
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/15-ssh-keys-only.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/15-ssh-keys-only.sh | ssh -o ControlPath=none -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no foundry-pi 'CONFIRM=1 bash -s'
# If the new connection fails, wait 5 minutes (the timer puts the old settings back) or log in at the console with
# the root password. Undo later: the same pipe with 'UNDO=1 bash -s' (removes the drop-in, reloads ssh).

require_root
sshd_main=/etc/ssh/sshd_config
drop_dir=/etc/ssh/sshd_config.d
drop="$drop_dir/00-foundry-keys-only.conf"
backup="$drop.before"
keys=/root/.ssh/authorized_keys
revert_unit=foundry-ssh-keys-only-revert
# Written by CONFIRM=1 (a new key-only connection worked); removed by UNDO=1, by a changed drop-in and by the timer.
confirmed=/etc/ssh/foundry-keys-only.confirmed
changed=0
had_old=0
unit=""
# The values this stage sets, as `sshd -T` prints them (lower-case names).
want_t="passwordauthentication no
kbdinteractiveauthentication no
permitrootlogin without-password"
# Who sshd is asked about: root from the machine itself, from a LAN address and from a public one.
probe_specs="user=root,host=localhost,addr=127.0.0.1 user=root,host=lan,addr=192.168.1.5 user=root,host=wan,addr=203.0.113.5"

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

need_unit() {
  unit="$(ssh_unit)" || die "found no ssh or sshd service to reload; nothing changed"
}

# The effective settings for a login described by a -C spec (Match blocks counted).
effective() {
  sshd -T -C "${1:-user=root,host=localhost,addr=127.0.0.1}" 2>/dev/null
}

# The three values sshd will use for one spec, one per line, lower-case, sorted by name.
values_for() {
  # OpenSSH before 10 prints prohibit-password as without-password (its old name); one spelling for the compare.
  effective "$1" | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' |
    sed 's/^permitrootlogin prohibit-password$/permitrootlogin without-password/' | sort -t' ' -k1,1 || true
}

# What would sshd say for the wanted values, sorted the same way.
want_sorted() {
  printf '%s\n' "$want_t" | sort -t' ' -k1,1
}

# True when every probed login gets exactly the wanted values.
values_are_wanted() {
  local spec
  for spec in $probe_specs; do
    [ "$(values_for "$spec")" = "$(want_sorted)" ] || return 1
  done
}

# Print the three effective values (root from the machine itself).
show_values() {
  values_for "${probe_specs%% *}" | sed 's/^/    sshd -T: /'
}

# Lines in the SSH settings that decide the three values, for the message when something overrides ours.
show_winners() {
  grep -HniE '^[[:space:]]*(PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PermitRootLogin|Match)[[:space:]=]' \
    "$sshd_main" "$drop_dir"/*.conf 2>/dev/null | sed 's/^/    /' >&2 || true
}

# Lines inside a Match block (per file, up to the next Match) that set a login value: file:line:text.
match_overrides() {
  local f
  for f in "$sshd_main" "$drop_dir"/*.conf; do
    [ -f "$f" ] || continue
    awk -v f="$f" '
      FNR == 1 { inmatch = 0 }
      { k = tolower($1); sub(/=.*/, "", k) }
      k == "match" { inmatch = 1; next }
      inmatch && k ~ /^(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|permitrootlogin|pubkeyauthentication|authenticationmethods)$/ { print f ":" FNR ":" $0 }
    ' "$f"
  done
}

# Put the drop-in back as it was before this run changed it.
rollback() {
  if [ "$had_old" = 1 ]; then
    mv -f "$backup" "$drop"
    warn "the old drop-in is back in place"
  else
    rm -f "${drop:?}"
    warn "$drop removed again"
  fi
}

cancel_timer() {
  if have_systemd; then
    systemctl stop "$revert_unit.timer" 2>/dev/null || true
    systemctl reset-failed "$revert_unit.service" "$revert_unit.timer" 2>/dev/null || true
  fi
}

timer_armed() {
  have_systemd && systemctl is-active --quiet "$revert_unit.timer"
}

# The safety timer: in 5 minutes the old drop-in comes back (or ours goes), the confirmation is dropped and ssh is
# reloaded, or started when it is down (reload-or-restart is a plain reload on a running ssh).
arm_timer() {
  local revert_cmd
  if [ -f "$backup" ]; then
    revert_cmd="/bin/mv -f $backup $drop"
  else
    revert_cmd="/bin/rm -f $drop"
  fi
  cancel_timer
  systemd-run --quiet --unit="$revert_unit" --on-active=300 /bin/sh -c "$revert_cmd; /bin/rm -f $confirmed; /bin/systemctl reload-or-restart $unit"
}

reload_ssh() {
  if have_systemd; then
    [ -n "$unit" ] || need_unit
    local reload_rc=0
    systemctl reload "$unit" || reload_rc=$?
    sleep 1
    if ! systemctl is-active --quiet "$unit"; then
      # A dead sshd (after a failed or a successful reload) is what the timer's reload cannot always fix by itself:
      # put the old drop-in back where this run changed it and start ssh (a start, not a restart: no open session is
      # touched). The timer is cancelled only once ssh is active again; otherwise it stays armed.
      [ "$changed" = 0 ] || rollback
      systemctl start "$unit" || true
      if systemctl is-active --quiet "$unit"; then
        [ "$changed" = 0 ] || cancel_timer
        die "$unit was not active after the reload; rolled back where this run changed the drop-in and started $unit again; see: journalctl -u $unit -n 30"
      fi
      die "$unit is NOT active after the reload and systemctl start did not bring it back (the safety timer, if armed, tries again in 5 minutes): log in at the console; see: journalctl -u $unit -n 30"
    fi
    [ "$reload_rc" = 0 ] || die "systemctl reload $unit failed (rc $reload_rc) but $unit is still active; the drop-in is in place and the running sshd may still have the old settings (a safety timer, if armed, takes the drop-in away); look at: journalctl -u $unit -n 30"
    ok "$unit reloaded (a reload: open sessions stay up)"
  else
    warn "no systemd here (a test container?): configuration written and checked, ssh not reloaded"
  fi
}

# What the running sshd offers a client that has no key: publickey only once the reload took. The files can say
# keys only while an old sshd still runs, so this asks the daemon itself.
live_check() {
  have_systemd || return 0
  if ! command -v ssh >/dev/null 2>&1; then
    warn "live: no ssh client here, so the running sshd was not asked what it offers"
    return 0
  fi
  local port out methods
  # awk reads all of sshd -T (an early exit would close the pipe: SIGPIPE, exit 141 under pipefail, set -e ends the stage).
  port="$(sshd -T 2>/dev/null | awk '$1 == "port" && p == "" { p = $2 } END { print p }' || true)"
  out="$(ssh -o BatchMode=yes -o PubkeyAuthentication=no -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o ConnectTimeout=5 -p "${port:-22}" root@127.0.0.1 true 2>&1 || true)"
  methods="$(printf '%s\n' "$out" | grep -o 'Permission denied ([^)]*)' | head -1 || true)"
  case "$methods" in
    '') warn "live: could not ask the running sshd what it offers (ssh said: $(printf '%s' "$out" | head -c 160)); check from the PC with the CONFIRM line" ;;
    *password* | *keyboard-interactive*)
      warn "live: the running sshd still offers a password ($methods): the reload may not have taken; the safety timer, if armed, will put the old settings back"
      return 1 ;;
    *) ok "live: the running sshd offers keys only ($methods)" ;;
  esac
}

# ---- UNDO ---------------------------------------------------------------------------------------------------------
if [ "${UNDO:-}" = 1 ]; then
  say "undo: the SSH settings as they were before this stage (a copy kept as $backup is not put back)"
  cancel_timer
  rm -f "${confirmed:?}"
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
  # The timer has elapsed and its service is undoing keys only right now: confirming would only write a marker for a change
  # that is being taken back. Checked again below, for a timer that fires while this confirm stops it.
  revert_running() {
    have_systemd && systemctl is-active --quiet "$revert_unit.service"
  }
  revert_running && die "the safety revert is running right now ($revert_unit.service): keys only is being taken back, so there is nothing to confirm. Wait for it to finish, then run the stage again and confirm within 5 minutes"
  [ -f "$drop" ] || die "$drop is not there: the safety timer already took it away, or the stage never ran; run it again, then confirm within 5 minutes"
  [ -n "${SSH_CONNECTION:-}" ] || warn "this does not look like an SSH session: confirm from a NEW connection that uses the key only"
  values_are_wanted || die "sshd does not use the wanted values any more; see: sshd -T"
  # The files say keys only; the running sshd has to say it too before the timer goes (the timer stays armed on a refusal).
  live_check || die "the running sshd still offers a password: the reload did not take; the timer stays armed (if it is); run the stage again, then confirm"
  if have_systemd; then
    if systemctl is-active --quiet "$revert_unit.timer"; then
      systemctl stop "$revert_unit.timer"
      if systemctl is-active --quiet "$revert_unit.timer"; then
        die "the revert timer is still active after stop: it would undo keys only; see: systemctl status $revert_unit.timer"
      fi
      ok "revert timer cancelled: keys only stays"
    else
      ok "no revert timer armed (nothing to cancel)"
    fi
  fi
  # The timer may have fired since the checks above: no marker for a drop-in that is gone or being removed.
  revert_running && die "the safety revert started while confirming ($revert_unit.service): keys only is being taken back. Wait for it to finish, then run the stage again and confirm within 5 minutes"
  [ -f "$drop" ] || die "$drop is gone (the safety timer fired while confirming): keys only is not in place; run the stage again, then confirm within 5 minutes"
  printf 'confirmed %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$confirmed"
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
# The service is looked up before the first write, so no step after the write can fail on it.
if have_systemd; then need_unit; fi
if have_systemd && systemctl is-active --quiet ssh.socket; then
  die "ssh is socket-activated (ssh.socket is active): a reload and the safety timer do not fit that setup; nothing changed"
fi
# Key login has to work for keys only to be a way in: the three settings, as sshd reads them for root.
key_login="$(effective || true)"
grep -qx 'pubkeyauthentication yes' <<<"$key_login" ||
  die "sshd does not accept public keys (PubkeyAuthentication): keys only would lock the SSH login out; nothing changed"
grep -qE '^authorizedkeysfile (.* )?(%h/|/root/)?\.ssh/authorized_keys( |$)' <<<"$key_login" ||
  die "sshd does not read root's .ssh/authorized_keys (AuthorizedKeysFile): keys only would lock the SSH login out; nothing changed"
grep -qx 'authenticationmethods any' <<<"$key_login" ||
  die "AuthenticationMethods asks for more than a key: keys only would lock the SSH login out; nothing changed"
ok "sshd takes root's key from .ssh/authorized_keys with no second method"
# A Match block overrides the global value whatever the file order, for the addresses and users it names; sshd -T
# below can only try a few, so a block that sets one of these values stops the stage.
match_hits="$(match_overrides)"
if [ -n "$match_hits" ]; then
  warn "a Match block sets a login value; it could turn passwords back on for the logins it names:"
  printf '%s\n' "$match_hits" | sed 's/^/    /' >&2
  die "remove or change those Match lines first; nothing changed"
fi
ok "no Match block sets a login value"
mkdir -p "$drop_dir"

# ---- The drop-in --------------------------------------------------------------------------------------------------
say "the drop-in"
body="# Written by scripts/pi/remote/15-ssh-keys-only.sh (D-123); edit it there. SSH logs in with a key only: no
# password, root only with a key. The root password still works at the console. Undo: that script with UNDO=1.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password"
if [ -f "$drop" ] && [ "$(cat "$drop")" = "$body" ]; then
  ok "$drop unchanged"
else
  changed=1
  # New content is not confirmed yet, whatever an earlier run recorded.
  rm -f "${confirmed:?}"
  if [ -f "$drop" ]; then
    had_old=1
    cp -a "$drop" "$backup"
    ok "copy of the old drop-in: $backup"
  else
    # A copy left by an earlier run must not become this run's revert target.
    rm -f "${backup:?}"
  fi
  # Not named *.conf, so sshd does not read it before it is in place; one rename puts it there.
  new="$drop.new"
  printf '%s\n' "$body" >"$new"
  chmod 0644 "$new"
  mv -f "$new" "$drop"
  ok "wrote $drop"
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

# ---- The safety net, then the reload ------------------------------------------------------------------------------
say "reload"
state=arm
if have_systemd; then
  if [ "$changed" = 0 ] && timer_armed; then
    state=armed
    ok "the safety timer of an earlier run is still armed (left as it is)"
  elif [ "$changed" = 0 ] && [ -f "$confirmed" ]; then
    state=confirmed
    ok "an earlier run was confirmed (CONFIRM=1): no new timer"
  else
    # Armed before the reload so a connection that fails to come back is put right even if nobody is looking.
    if ! arm_timer; then
      if [ "$changed" = 1 ]; then
        rollback
        die "could not arm the safety timer; rolled back, ssh was not reloaded"
      fi
      die "could not arm the safety timer; ssh was not reloaded"
    fi
    ok "safety net: the old SSH settings come back in 5 minutes unless a new connection confirms (CONFIRM=1)"
  fi
else
  state=nosystemd
  warn "no systemd here (a test container?): no safety timer"
fi
reload_ssh
live_check || true
show_values
case "$state" in
  armed) say "stage 15: the drop-in was already there and the safety timer of the earlier run is still armed: confirm from a NEW key-only connection (CONFIRM=1, see the header) before it fires" ;;
  confirmed) say "stage 15 done: SSH is keys only (the drop-in was already there and confirmed)" ;;
  nosystemd) say "stage 15 done (files only, no systemd here)" ;;
  *) say "stage 15 done: confirm from a NEW key-only connection within 5 minutes (CONFIRM=1, see the header); the console login with the root password is the way back in" ;;
esac
