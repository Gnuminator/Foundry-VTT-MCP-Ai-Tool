#!/usr/bin/env bash
# Stage 35: the "Who uses what" note written by the Pi (backlog who-uses-what-pi-job, D-146). A systemd timer asks the Pi
# dashboard for the GM-only usage report every 4 hours and on Sunday 23:00, renders it with who-uses-what.mjs and pushes it to
# the vault repo as "Dev/Foundry AI Tool/Who uses what.md", where the PM board's Who tab reads it. The Pi is always on, so the
# reading is fresh without the user's PC. The note holds names, versions, tool names and counts only; never typed text.
#
# What it changes, nothing else:
#   1. installs scripts/who-uses-what.mjs and scripts/pi/who-uses-what-push.sh into $TOOL_DIR/who-uses-what (copy both to /root
#      first, see below; Node's built-ins only, so no npm install and no dependency on the release build);
#   2. makes the state folder /var/lib/foundry-ai-tool-who-uses-what (foundry, 0700; outside $TOOL_DATA, so the nightly restic
#      backup does not carry the key; a restore needs a new key) and in it a deploy key pair (ssh-keygen as foundry, the
#      private key never leaves the Pi and is never printed) and a known_hosts file with GitHub's published ed25519 key;
#   3. writes the unit foundry-ai-tool-who-uses-what.service (oneshot, User=foundry, reads dashboard-access.env for the GM token)
#      and the timer, then takes ONE reading now. The timer is enabled only when that reading was pushed. The job keeps a sparse
#      depth-1 blobless clone of the vault repo in the state folder: the file list of the vault and the one note, never the other
#      notes' content.
# It restarts nothing: the bridge, the dashboard, Foundry and the recorder are not touched, so it needs no quiet check.
#
# First run, in two steps: the first run prints the public key and stops at the reading ("deploy key not accepted yet"). The USER
# adds it on GitHub (repo Gnuminator/obsidian-vault, Settings, Deploy keys, "Allow write access"); then run the stage again.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    read the report and list the vault repo with the key, as the foundry user (no write, no push); exit 1 when one fails
#   UNDO=1     stop and remove the timer, the service and the installed files; the state folder (key, clone) is kept
# A real run (and UNDO) needs a dietpi-backup snapshot from today and the user's OK. These lines are bash:
#   scp scripts/who-uses-what.mjs scripts/pi/who-uses-what-push.sh foundry-pi:/root/   (from a clean checkout of main at the merge commit)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/35-who-uses-what.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/35-who-uses-what.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/35-who-uses-what.sh | ssh foundry-pi 'CHECK=1 bash -s'
# Tests only: SRC_DIR, UNIT_DIR (TOOL_ETC, TOOL_DIR, TOOL_DATA and NODE_DIR are set by lib.sh, so they are not overrides).

dry="${DRY_RUN:-0}"
check="${CHECK:-0}"
undo="${UNDO:-0}"
src_dir="${SRC_DIR:-/root}"
unit_dir="${UNIT_DIR:-/etc/systemd/system}"
unit_name=foundry-ai-tool-who-uses-what
service_file="$unit_dir/$unit_name.service"
timer_file="$unit_dir/$unit_name.timer"
dest="$TOOL_DIR/who-uses-what"
state=/var/lib/foundry-ai-tool-who-uses-what
access_env="$TOOL_ETC/dashboard-access.env"
files="who-uses-what.mjs who-uses-what-push.sh"
key="$state/id_ed25519"
# GitHub's published SSH host key (docs.github.com, "GitHub's SSH key fingerprints"; also `gh api meta`, ssh_keys). The job
# pins it with StrictHostKeyChecking=yes, so a changed key stops the job instead of being trusted.
github_hostkey='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

require_root
modes=0
for m in "$dry" "$check" "$undo"; do [ "$m" = 1 ] && modes=$((modes + 1)); done
[ "$modes" -le 1 ] || die "use one of DRY_RUN=1, CHECK=1 and UNDO=1, not several"
if [ "$dry" != 1 ] && [ "$check" != 1 ]; then require_recent_snapshot; fi

want_service="[Unit]
Description=Foundry AI Tool: write the Who uses what note and push it to the vault repo
After=network-online.target foundry-ai-tool-dashboard.service
Wants=network-online.target

[Service]
Type=oneshot
User=$FOUNDRY_USER
Group=$FOUNDRY_USER
EnvironmentFile=-$access_env
Environment=WUW_DIR=$state
Environment=WUW_NODE=$NODE_DIR/bin/node
Environment=WUW_SCRIPT=$dest/who-uses-what.mjs
ExecStart=/usr/bin/env bash $dest/who-uses-what-push.sh
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$state
TimeoutStartSec=300"

want_timer="[Unit]
Description=Foundry AI Tool: Who uses what reading, every 4 hours and Sunday 23:00

[Timer]
OnCalendar=*-*-* 00/4:25:00
OnCalendar=Sun *-*-* 23:00:00
RandomizedDelaySec=120
# No catch-up run for a missed time: the next one is at most 4 hours away, and a run at boot would fire before the network is ready.
Persistent=false

[Install]
WantedBy=timers.target"

if [ "$check" = 1 ]; then
  say "check: the report and the vault repo, as $FOUNDRY_USER (nothing written, nothing pushed)"
  [ -f "$dest/who-uses-what-push.sh" ] || die "the job is not installed ($dest): run this stage without CHECK first"
  [ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
  command -v runuser >/dev/null 2>&1 || die "runuser not found"
  say "installed files (compare with the repo at the merge commit)"
  (cd "$dest" && sha256sum $files) | sed 's/^/    /' || true
  # The job reads the token from the env file itself, so it never sits on a command line.
  rc=0
  out="$(runuser -u "$FOUNDRY_USER" -- env WUW_MODE=check WUW_DIR="$state" WUW_NODE="$NODE_DIR/bin/node" WUW_SCRIPT="$dest/who-uses-what.mjs" \
    WUW_ENV_FILE="$access_env" bash "$dest/who-uses-what-push.sh" 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/    /' || true
  if have_systemd; then
    systemctl is-enabled --quiet "$unit_name.timer" && ok "$unit_name.timer is enabled" || warn "$unit_name.timer is not enabled yet (run the stage when the deploy key is added)"
    systemctl list-timers "$unit_name.timer" --no-pager </dev/null 2>/dev/null | sed 's/^/    /' || true
  fi
  [ "$rc" -eq 0 ] || die "the check failed (see above)"
  say "stage 35 check: ok"
  exit 0
fi

if [ "$undo" = 1 ]; then
  say "undo: remove the timer, the service and the installed files (the state folder with the key and the clone stays)"
  if [ "$dry" = 1 ]; then say "DRY_RUN=1: nothing changed"; exit 0; fi
  if have_systemd; then
    systemctl stop "$unit_name.timer" 2>/dev/null || true
    systemctl disable "$unit_name.timer" >/dev/null 2>&1 || true
  fi
  rm -f "${timer_file:?}" "${service_file:?}"
  rm -rf "${dest:?}"
  have_systemd && systemctl daemon-reload
  ok "removed the units and $dest; $state is kept (the deploy key can be removed on GitHub)"
  say "stage 35 done: removed"
  exit 0
fi

say "checking before anything is written"
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
for t in git ssh-keygen runuser; do command -v "$t" >/dev/null 2>&1 || die "$t is not installed (apt install git openssh-client)"; done
for f in $files; do
  [ -f "$src_dir/$f" ] || die "$src_dir/$f is missing: scp scripts/who-uses-what.mjs scripts/pi/who-uses-what-push.sh foundry-pi:/root/ first"
done
"$NODE_DIR/bin/node" --check "$src_dir/who-uses-what.mjs" || die "who-uses-what.mjs does not parse on this Node"
bash -n "$src_dir/who-uses-what-push.sh" || die "who-uses-what-push.sh does not parse"
[ -f "$access_env" ] && grep -qE '^[[:space:]]*GM_DASHBOARD_TOKEN=[^[:space:]]' "$access_env" ||
  die "$access_env has no GM_DASHBOARD_TOKEN: the dashboard would refuse the report (run set-dashboard-access.sh first)"
ok "sources, Node, git and the GM token (name only) are in place"

plan_files="install $dest"
cmp_all=1
for f in $files; do cmp -s "$src_dir/$f" "$dest/$f" 2>/dev/null || cmp_all=0; done
[ "$cmp_all" = 1 ] && plan_files="nothing to do"
plan_key="generate the deploy key"
[ -f "$key" ] && plan_key="kept as it is"
plan_units="write the service and the timer"
[ -f "$service_file" ] && [ "$(cat "$service_file")" = "$want_service" ] && [ -f "$timer_file" ] && [ "$(cat "$timer_file")" = "$want_timer" ] && plan_units="nothing to do"
say "plan: files: $plan_files; deploy key: $plan_key; units: $plan_units; then one reading pushed to the vault repo, and the timer enabled when it worked"
if [ "$dry" = 1 ]; then
  say "DRY_RUN=1: nothing changed"
  exit 0
fi

say "the files"
if [ "$cmp_all" = 1 ]; then
  ok "$dest already has both files"
else
  install -d -m 0755 -o root -g root "$dest"
  for f in $files; do install -m 0644 -o root -g root "$src_dir/$f" "$dest/$f"; done
  ok "installed $files in $dest"
fi
(cd "$dest" && sha256sum $files >SHA256SUMS)
chmod 0644 "$dest/SHA256SUMS"
sed 's/^/    /' "$dest/SHA256SUMS" || true

say "the state folder, the deploy key and the host key"
# $state sits beside $TOOL_DATA, not inside it: /var/lib is root's, so the foundry user (Foundry, the bridge, the dashboard run as
# it) cannot swap the folder for a link, and the nightly restic backup of $TOOL_DATA does not carry the key or the clone.
# Everything INSIDE it is written as the foundry user, never by root (a link planted there must not make root write elsewhere).
[ ! -L "$state" ] || die "$state is a symbolic link: refusing"
[ -d "$state" ] || install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$state"
[ "$(stat -c %U "$state")" = "$FOUNDRY_USER" ] || die "$state is not owned by $FOUNDRY_USER"
as_foundry() { runuser -u "$FOUNDRY_USER" -- "$@"; }
if [ -f "$key" ]; then
  ok "the deploy key is already there (kept as it is)"
else
  as_foundry ssh-keygen -q -t ed25519 -N '' -C "foundry-pi who-uses-what" -f "$key" || die "ssh-keygen failed"
  ok "generated the deploy key (the private half stays in $state, never printed)"
fi
as_foundry sh -c 'umask 022; [ -f "$1.pub" ] || ssh-keygen -y -f "$1" >"$1.pub"' sh "$key" || die "no public key for $key"
as_foundry sh -c 'umask 022; printf "%s\n" "$1" >"$2.tmp" && mv -f "$2.tmp" "$2"' sh "$github_hostkey" "$state/known_hosts" || die "could not write known_hosts"
as_foundry chmod 0600 "$key" || die "chmod of the key failed"
as_foundry chmod 0644 "$key.pub" "$state/known_hosts" || die "chmod failed"

say "the units"
write_file "$service_file" 0644 "$want_service" || true
write_file "$timer_file" 0644 "$want_timer" || true

if ! have_systemd; then
  warn "no systemd here (a test container?): files, key and units written, nothing started"
  say "stage 35 done"
  exit 0
fi
systemctl daemon-reload

say "one reading now (it is pushed to the vault repo)"
if ! systemctl start "$unit_name.service"; then
  journalctl -u "$unit_name.service" -n 8 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
  say "the public deploy key (safe to show), for GitHub: repo Gnuminator/obsidian-vault, Settings, Deploy keys, Add, tick Allow write access:"
  sed 's/^/    /' "$key.pub" || true
  die "the reading failed (most likely the deploy key is not accepted yet); the timer is NOT enabled. Add the key, then run this stage again"
fi
ok "the reading was pushed"
journalctl -u "$unit_name.service" -n 4 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
systemctl enable --now "$unit_name.timer" >/dev/null 2>&1 || die "could not enable $unit_name.timer"
ok "$unit_name.timer enabled"
systemctl list-timers "$unit_name.timer" --no-pager </dev/null 2>/dev/null | sed 's/^/    /' || true

ok "next: the board's Who tab shows the new reading after the PC pulls the vault (git pull) and the board rebuilds"
say "stage 35 done"
