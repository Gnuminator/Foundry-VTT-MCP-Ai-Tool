#!/usr/bin/env bash
# Stage 15 (scripts/pi/remote/15-ssh-keys-only.sh) in a Debian 13 ARM64 container with the real OpenSSH server
# (sshd -t and sshd -T are the real ones) and no systemd: stand-ins for systemctl and systemd-run make the stage take
# its systemd path (a reload call, the safety timer). Each scenario starts from a fresh fake Pi (the default
# sshd_config of Debian with root and password login switched on, like the Pi) and prints one block that
# scripts/pi/ssh-keys-only.test.mjs reads:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/ssh-keys-only-scenarios.sh [name ...]
# (<IMAGE> is the pinned Debian 13 image in ssh-keys-only.test.mjs.) With names, only those scenarios run.
#
# DESTRUCTIVE: each scenario rewrites /etc/ssh and /root/.ssh, and the fakes go into /usr/local/sbin and
# /usr/local/shim. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE=/repo/scripts/pi/remote/15-ssh-keys-only.sh
LIB=/repo/scripts/pi/remote/lib.sh

export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends openssh-server openssh-client passwd; }
# One retry: a Debian mirror hiccup should not fail a required CI check.
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /run/sshd /root/.ssh
ssh-keygen -A >/dev/null 2>&1
cp /etc/ssh/sshd_config /root/sshd_config.pristine
ssh-keygen -q -t ed25519 -N '' -C pc-key -f /root/k1
ssh-keygen -q -t ed25519 -N '' -C second-key -f /root/k2

# systemctl stand-in: logs the call; "cat" finds ssh.service only (/tmp/no-unit: nothing); the revert timer is active
# while /tmp/timer-armed exists; ssh.socket while /tmp/socket-active exists; ssh.service is inactive while /tmp/ssh-dead
# exists (a reload sets it when /tmp/ssh-dies-on-reload exists, "start" clears it); a reload sends SIGHUP to a real
# sshd when /tmp/live-sshd exists (and not /tmp/reload-noop).
install -d /usr/local/sbin /usr/local/shim
cat >/usr/local/sbin/systemctl <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>/tmp/calls
case "${1:-}" in
  cat) [ ! -f /tmp/no-unit ] || exit 1; [ "${2:-}" = ssh.service ] || exit 1 ;;
  is-active)
    case "${@: -1}" in
      foundry-ssh-keys-only-revert.timer) [ -f /tmp/timer-armed ] || exit 3 ;;
      ssh.socket) [ -f /tmp/socket-active ] || exit 3 ;;
      *) [ ! -f /tmp/ssh-dead ] || exit 3 ;;
    esac ;;
  start) rm -f /tmp/ssh-dead ;;
  stop) case "$*" in *foundry-ssh-keys-only-revert.timer*) rm -f /tmp/timer-armed ;; esac ;;
  reload | reload-or-restart)
    [ ! -f /tmp/reloadfail ] || exit 1
    [ ! -f /tmp/ssh-dies-on-reload ] || touch /tmp/ssh-dead
    if [ -f /tmp/live-sshd ] && [ ! -f /tmp/reload-noop ] && [ -f /run/sshd.pid ]; then kill -HUP "$(cat /run/sshd.pid)"; sleep 1; fi ;;
esac
exit 0
EOF
# systemd-run stand-in: logs the call, keeps the command the timer would run (the last argument), marks the timer armed.
cat >/usr/local/sbin/systemd-run <<'EOF'
#!/usr/bin/env bash
echo "systemd-run $*" >>/tmp/calls
[ ! -f /tmp/timerfail ] || exit 1
for a in "$@"; do last="$a"; done
printf '%s\n' "$last" >/tmp/revert-cmd
touch /tmp/timer-armed
exit 0
EOF
# sshd shim in front of the real one: /tmp/sshd-t-fail makes `sshd -t` fail while the stage's drop-in is in place.
cat >/usr/local/shim/sshd <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = -t ] && [ -f /tmp/sshd-t-fail ] && grep -qs '^PermitRootLogin prohibit-password' /etc/ssh/sshd_config.d/00-foundry-keys-only.conf; then
  echo "/etc/ssh/sshd_config.d/00-foundry-keys-only.conf: simulated error" >&2
  exit 255
fi
exec /usr/sbin/sshd "$@"
EOF
chmod 755 /usr/local/sbin/systemctl /usr/local/sbin/systemd-run /usr/local/shim/sshd
mkdir -p /run/systemd/system # have_systemd() looks for this folder

KEY1="$(cat /root/k1.pub)"
KEY2="$(cat /root/k2.pub)"

fresh_pi() {
  pkill -x sshd 2>/dev/null || true
  rm -f /tmp/calls /tmp/timer-armed /tmp/revert-cmd /tmp/reloadfail /tmp/timerfail /tmp/sshd-t-fail /tmp/no-unit \
    /tmp/socket-active /tmp/ssh-dead /tmp/ssh-dies-on-reload /tmp/live-sshd /tmp/reload-noop /run/sshd.pid \
    /etc/ssh/foundry-keys-only.confirmed
  rm -rf /etc/ssh/sshd_config.d
  mkdir -p /etc/ssh/sshd_config.d
  cp /root/sshd_config.pristine /etc/ssh/sshd_config
  # The Pi: root and password login on, from DietPi's own drop-in (it sorts after ours).
  printf '# Added by DietPi:\nPasswordAuthentication yes\nPermitRootLogin yes\n' >/etc/ssh/sshd_config.d/dietpi.conf
  # The PC's key, with the stage 9 command log prefix, a comment line and a second plain key.
  {
    echo "# keys of the PC"
    echo "command=\"/usr/local/sbin/foundry-ssh-log\" $KEY1"
    echo "$KEY2"
  } >/root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
}

# run_stage [VAR=value ...]: the stage as the PC pipes it, with the given environment; prints the output and sets RC.
run_stage() {
  OUT="$(cat "$LIB" "$STAGE" | env PATH="/usr/local/shim:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin" "$@" bash -s 2>&1)"
  RC=$?
}

values() {
  /usr/sbin/sshd -T -C user=root,host=localhost,addr=127.0.0.1 2>&1 | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' | sort
}

block() {
  local name="$1"
  echo "=== SCENARIO $name"
  echo "--- output"
  printf '%s\n' "$OUT"
  echo "--- exit $RC"
  echo "--- dropin"
  cat /etc/ssh/sshd_config.d/00-foundry-keys-only.conf 2>/dev/null || echo "(none)"
  echo "--- before"
  cat /etc/ssh/sshd_config.d/00-foundry-keys-only.conf.before 2>/dev/null || echo "(none)"
  echo "--- values"
  values
  echo "--- calls"
  cat /tmp/calls 2>/dev/null || true
  echo "--- timer"
  if [ -f /tmp/timer-armed ]; then echo armed; else echo none; fi
  echo "--- marker"
  if [ -f /etc/ssh/foundry-keys-only.confirmed ]; then echo confirmed; else echo none; fi
  echo "--- extra"
  [ -z "${EXTRA:-}" ] || printf '%s\n' "$EXTRA"
  EXTRA=""
  echo "=== END"
}

want=("$@")
selected() {
  [ "${#want[@]}" -eq 0 ] && return 0
  local w
  for w in "${want[@]}"; do [ "$w" = "$1" ] && return 0; done
  return 1
}

if selected fresh; then
  fresh_pi
  run_stage
  EXTRA="stray: $(ls /etc/ssh/sshd_config.d | tr '\n' ' ')"
  block fresh
fi

if selected confirm; then
  fresh_pi
  run_stage
  run_stage CONFIRM=1
  block confirm
fi

if selected confirm-without-stage; then
  fresh_pi
  run_stage CONFIRM=1
  block confirm-without-stage
fi

if selected undo; then
  fresh_pi
  run_stage
  run_stage UNDO=1
  block undo
fi

# The timer's command, run as systemd would (the real systemctl is the stand-in): the drop-in goes, ssh reloads.
if selected timer-revert; then
  fresh_pi
  run_stage
  : >/tmp/calls
  cmd="$(sed 's|/bin/systemctl|systemctl|g' /tmp/revert-cmd)"
  OUT="$(env PATH="/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin" sh -c "$cmd" 2>&1)"
  RC=$?
  EXTRA="revert-cmd: $(cat /tmp/revert-cmd)"
  block timer-revert
fi

if selected replaces-old; then
  fresh_pi
  printf '# an older version\nPasswordAuthentication no\n' >/etc/ssh/sshd_config.d/00-foundry-keys-only.conf
  run_stage
  EXTRA="revert-cmd: $(cat /tmp/revert-cmd 2>/dev/null)"
  block replaces-old
fi

if selected no-keys-file; then
  fresh_pi
  rm -f /root/.ssh/authorized_keys
  run_stage
  block no-keys-file
fi

if selected empty-keys; then
  fresh_pi
  printf '# nothing but a comment\n\nnot a key at all\n' >/root/.ssh/authorized_keys
  run_stage
  block empty-keys
fi

if selected no-include; then
  fresh_pi
  grep -v '^Include' /root/sshd_config.pristine >/etc/ssh/sshd_config
  printf '\nPermitRootLogin yes\nPasswordAuthentication yes\n' >>/etc/ssh/sshd_config
  run_stage
  block no-include
fi

# An Include line that is commented out does not count.
if selected commented-include; then
  fresh_pi
  sed -i 's|^Include|#Include|' /etc/ssh/sshd_config
  run_stage
  block commented-include
fi

# A value set above the Include line wins (sshd keeps the first value it reads): the drop-in is rolled back.
if selected overridden-above; then
  fresh_pi
  { echo 'PasswordAuthentication yes'; cat /root/sshd_config.pristine; } >/etc/ssh/sshd_config
  run_stage
  block overridden-above
fi

# A Match block for root that switches password login on again.
if selected overridden-match; then
  fresh_pi
  printf '\nMatch User root\n    PasswordAuthentication yes\n' >>/etc/ssh/sshd_config
  run_stage
  block overridden-match
fi

# A drop-in that sorts before ours and sets a value (the file name 00-... is ours; this one is 00-a...).
if selected overridden-earlier-file; then
  fresh_pi
  printf 'PermitRootLogin yes\n' >/etc/ssh/sshd_config.d/00-a-earlier.conf
  run_stage
  block overridden-earlier-file
fi

# A cloud-init style drop-in that sorts after ours (next to dietpi.conf): ours wins.
if selected later-file; then
  fresh_pi
  printf 'PasswordAuthentication yes\n' >/etc/ssh/sshd_config.d/50-cloud-init.conf
  run_stage
  block later-file
fi

# A Match block that sets none of the login values (X11Forwarding) is no reason to stop.
if selected unrelated-match; then
  fresh_pi
  printf '\nMatch Address 10.99.0.0/16\n    X11Forwarding no\n' >>/etc/ssh/sshd_config
  run_stage
  block unrelated-match
fi

if selected sshd-t-fails; then
  fresh_pi
  touch /tmp/sshd-t-fail
  run_stage
  block sshd-t-fails
fi

if selected sshd-t-fails-old; then
  fresh_pi
  printf '# an older version\nPasswordAuthentication no\n' >/etc/ssh/sshd_config.d/00-foundry-keys-only.conf
  touch /tmp/sshd-t-fail
  run_stage
  block sshd-t-fails-old
fi

# sshd -t already failing before the stage touches anything.
if selected broken-before; then
  fresh_pi
  printf 'NotAnOption yes\n' >>/etc/ssh/sshd_config
  run_stage
  block broken-before
fi

if selected timer-fails; then
  fresh_pi
  touch /tmp/timerfail
  run_stage
  block timer-fails
fi

# No systemd (a plain container): the files are written and checked, nothing is reloaded, no timer.
if selected no-systemd; then
  fresh_pi
  rmdir /run/systemd/system /run/systemd 2>/dev/null
  run_stage
  mkdir -p /run/systemd/system
  block no-systemd
fi

if selected reload-fails; then
  fresh_pi
  touch /tmp/reloadfail
  run_stage
  block reload-fails
fi

# Within the 5 minutes, the first run's timer is still armed: a rerun reloads, leaves it armed and says so.
if selected rerun-timer-armed; then
  fresh_pi
  run_stage
  : >/tmp/calls
  run_stage
  block rerun-timer-armed
fi

# After CONFIRM=1 a rerun only reloads: no timer, no systemd-run.
if selected rerun-confirmed; then
  fresh_pi
  run_stage
  run_stage CONFIRM=1
  : >/tmp/calls
  run_stage
  block rerun-confirmed
fi

# The first run stopped (or the Pi rebooted) after the drop-in was written: no timer, no confirmation. The rerun finds
# the drop-in unchanged and must arm the timer before it reloads.
if selected rerun-lost-timer; then
  fresh_pi
  run_stage
  rm -f /tmp/timer-armed
  : >/tmp/calls
  run_stage
  block rerun-lost-timer
fi

# A confirmed drop-in that is then replaced is unconfirmed again: the marker goes and a new timer is armed.
if selected changed-after-confirm; then
  fresh_pi
  run_stage
  run_stage CONFIRM=1
  printf '# a changed version\nPasswordAuthentication no\n' >/etc/ssh/sshd_config.d/00-foundry-keys-only.conf
  : >/tmp/calls
  run_stage
  block changed-after-confirm
fi

# ssh dies on the reload: the drop-in is rolled back, ssh is started, the timer is cancelled.
if selected dead-after-reload; then
  fresh_pi
  touch /tmp/ssh-dies-on-reload
  run_stage
  block dead-after-reload
fi

# Same with an older drop-in in place: it comes back.
if selected dead-after-reload-old; then
  fresh_pi
  printf '# an older version\nPasswordAuthentication no\n' >/etc/ssh/sshd_config.d/00-foundry-keys-only.conf
  touch /tmp/ssh-dies-on-reload
  run_stage
  block dead-after-reload-old
fi

# No ssh or sshd service: refused before anything is written.
if selected no-unit; then
  fresh_pi
  touch /tmp/no-unit
  run_stage
  block no-unit
fi

if selected socket-activated; then
  fresh_pi
  touch /tmp/socket-active
  run_stage
  block socket-activated
fi

# A Match block for another address turns passwords on: the global values look right, the stage still refuses.
if selected lan-match; then
  fresh_pi
  printf '\nMatch Address 192.168.0.0/16\n    PasswordAuthentication yes\n' >>/etc/ssh/sshd_config
  run_stage
  block lan-match
fi

# The same in a drop-in file that sorts after ours.
if selected lan-match-dropin; then
  fresh_pi
  printf 'Match Address 10.0.0.0/8\n    PermitRootLogin yes\n' >/etc/ssh/sshd_config.d/90-lan.conf
  run_stage
  block lan-match-dropin
fi

# Key login that would not work: refused before anything is written.
if selected pubkey-off; then
  fresh_pi
  printf '\nPubkeyAuthentication no\n' >>/etc/ssh/sshd_config
  run_stage
  block pubkey-off
fi

if selected keys-file-elsewhere; then
  fresh_pi
  printf '\nAuthorizedKeysFile /etc/ssh/keys/%%u\n' >>/etc/ssh/sshd_config
  run_stage
  block keys-file-elsewhere
fi

if selected two-methods; then
  fresh_pi
  printf '\nAuthenticationMethods publickey,password\n' >>/etc/ssh/sshd_config
  run_stage
  block two-methods
fi

# A real sshd on port 22, reloaded by SIGHUP: the live check sees keys only after the reload...
if selected live-keys-only; then
  fresh_pi
  touch /tmp/live-sshd
  /usr/sbin/sshd
  sleep 1
  run_stage
  block live-keys-only
fi

# ...and warns when the daemon still has the old settings (a reload that did nothing).
if selected live-stale; then
  fresh_pi
  touch /tmp/live-sshd /tmp/reload-noop
  /usr/sbin/sshd
  sleep 1
  run_stage
  block live-stale
fi

pkill -x sshd 2>/dev/null || true
echo "=== ALL DONE"
