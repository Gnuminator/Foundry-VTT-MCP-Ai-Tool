#!/usr/bin/env bash
# Stage 29: the game-night watch as a Pi service (backlog watch-on-pi). While a play session is marked, it checks Foundry,
# the dashboard (/api/health), the bridge link to Foundry's module, the Discord recorder and, when a token is set, the public
# address through Cloudflare Access, and posts to #gm-bot when it starts, on every change, and when the session ends. The
# GM then gets the alerts without the user's PC. Nothing it posts or logs holds an address, a query string or a token.
#
# What it changes, nothing else:
#   1. installs scripts/gamenight-watch.mjs and scripts/gamenight-watch-pi.mjs into $TOOL_DIR/gamenight-watch (copy both to
#      /root first, see below; the watch uses Node's built-ins only, so there is no npm install and no dependency on the
#      release build);
#   2. creates $TOOL_ETC/gamenight-watch.env (root:foundry 0640) from a template when it is missing, and never touches it
#      again: it is where the user adds the public address and the Access service token. Without them the public check is off;
#   3. writes the unit /etc/systemd/system/foundry-ai-tool-gamenight-watch.service (User=foundry, reads discord-bot.env for the
#      bot token and #gm-bot, and gamenight-watch.env), enables and starts it. It idles until a session is marked.
# It restarts nothing else: the bridge, the dashboard, Foundry and the recorder are not touched, so it needs no quiet check. A
# changed watch unit or script restarts the watch itself (it re-reads the session at once; a running watch posts one "stopped"
# line and one "started" line).
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    run one round of the five checks as the foundry user, log only (no post); exit 1 when one fails; changes nothing
#   UNDO=1     stop and remove the service and the installed files; the settings file is kept (it may hold the token)
# A real run (and UNDO) needs a dietpi-backup snapshot from today and the user's OK. These lines are bash:
#   scp scripts/gamenight-watch.mjs scripts/gamenight-watch-pi.mjs foundry-pi:/root/   (from a clean checkout of main at the merge commit)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/29-gamenight-watch.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/29-gamenight-watch.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/29-gamenight-watch.sh | ssh foundry-pi 'CHECK=1 bash -s'
# The service token is added by the user, never by Claude: edit $TOOL_ETC/gamenight-watch.env on the Pi, then
# `systemctl restart foundry-ai-tool-gamenight-watch`. Tests only: SRC_DIR, TOOL_ETC, TOOL_DIR, UNIT_DIR, NODE_DIR.

dry="${DRY_RUN:-0}"
check="${CHECK:-0}"
undo="${UNDO:-0}"
src_dir="${SRC_DIR:-/root}"
unit_dir="${UNIT_DIR:-/etc/systemd/system}"
unit=foundry-ai-tool-gamenight-watch.service
unit_file="$unit_dir/$unit"
dest="$TOOL_DIR/gamenight-watch"
watch_env="$TOOL_ETC/gamenight-watch.env"
bot_env="$TOOL_ETC/discord-bot.env"
files="gamenight-watch.mjs gamenight-watch-pi.mjs"

require_root
modes=0
for m in "$dry" "$check" "$undo"; do [ "$m" = 1 ] && modes=$((modes + 1)); done
[ "$modes" -le 1 ] || die "use one of DRY_RUN=1, CHECK=1 and UNDO=1, not several"
if [ "$dry" != 1 ] && [ "$check" != 1 ]; then require_recent_snapshot; fi

# A key with a value in an env file, by name only (the files hold the token).
has_key() { grep -qE "^[[:space:]]*$2=[^[:space:]]" "$1" 2>/dev/null; }

template="# Game-night watch on the Pi (stage 29, scripts/pi/remote/29-gamenight-watch.sh). The Discord token and the #gm-bot
# channel come from discord-bot.env. Everything here is optional.
#
# The public check (the address players use, through Cloudflare Access) is off until all three lines are filled in.
# Give the address without a query string. Keep this file root:foundry 0640; never paste its content anywhere.
#WATCH_PUBLIC_URL=https://example.invalid
#CF_ACCESS_CLIENT_ID=
#CF_ACCESS_CLIENT_SECRET=
#
# Other settings and their defaults:
#WATCH_FOUNDRY_URL=http://127.0.0.1:30000
#WATCH_DASHBOARD_URL=http://127.0.0.1:3000
#WATCH_CONTROL_PORT=31414
#WATCH_RECORDER_UNIT=foundry-ai-tool-discord-bot.service
# With stage 27 done, the recorder's own problem list is checked too:
#WATCH_RECORDER_STATUS_URL=http://127.0.0.1:3110/status"

want_unit="[Unit]
Description=Foundry AI Tool: game-night watch (posts to #gm-bot while a session is marked)
After=network-online.target foundry.service foundry-ai-tool-bridge.service
Wants=network-online.target

[Service]
Type=simple
User=$FOUNDRY_USER
Group=$FOUNDRY_USER
EnvironmentFile=-$bot_env
EnvironmentFile=-$watch_env
ExecStart=$NODE_DIR/bin/node $dest/gamenight-watch-pi.mjs --post
Restart=always
RestartSec=10
# Exit 2 is a settings problem (no token, Discord refuses the channel): a restart every 10 s would only ask Discord again.
RestartPreventExitStatus=2
Nice=10
MemoryMax=128M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target"

if [ "$check" = 1 ]; then
  say "check: one round of the checks, as $FOUNDRY_USER, log only"
  [ -f "$dest/gamenight-watch-pi.mjs" ] || die "the watch is not installed ($dest): run this stage without CHECK first"
  [ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
  command -v runuser >/dev/null 2>&1 || die "runuser not found"
  say "installed files (compare with the repo at the merge commit)"
  (cd "$dest" && sha256sum $files) | sed 's/^/    /'
  out="$(runuser -u "$FOUNDRY_USER" -- "$NODE_DIR/bin/node" "$dest/gamenight-watch-pi.mjs" --once --always --env-file "$bot_env,$watch_env" 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/    /'
  if have_systemd; then
    systemctl is-active --quiet "$unit" && ok "$unit is running" || die "$unit is not running: journalctl -u $unit -n 20"
  fi
  if [ "${rc:-0}" -ne 0 ] || printf '%s\n' "$out" | grep -q ' FAIL '; then
    die "at least one check failed (see above; the bridge link fails while no world is running, which is expected off game night)"
  fi
  say "stage 29 check: all checks ok"
  exit 0
fi

if [ "$undo" = 1 ]; then
  say "undo: remove the service and the installed files (the settings file stays)"
  if [ "$dry" = 1 ]; then say "DRY_RUN=1: nothing changed"; exit 0; fi
  if have_systemd; then
    systemctl stop "$unit" 2>/dev/null || true
    systemctl disable "$unit" >/dev/null 2>&1 || true
  fi
  rm -f "${unit_file:?}"
  rm -rf "${dest:?}"
  have_systemd && systemctl daemon-reload
  ok "removed $unit_file and $dest; $watch_env is kept"
  say "stage 29 done: removed"
  exit 0
fi

say "checking before anything is written"
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
for f in $files; do
  [ -f "$src_dir/$f" ] || die "$src_dir/$f is missing: scp scripts/gamenight-watch.mjs scripts/gamenight-watch-pi.mjs foundry-pi:/root/ first"
done
[ -f "$bot_env" ] || die "$bot_env is missing: run stage 8 first"
has_key "$bot_env" DISCORD_TOKEN || die "$bot_env has no DISCORD_TOKEN: the user runs scripts/pi/set-discord-token.ps1 first"
has_key "$bot_env" GAMENIGHT_WATCH_CHANNEL_ID || die "$bot_env has no GAMENIGHT_WATCH_CHANNEL_ID (#gm-bot): run stage 26 first"
"$NODE_DIR/bin/node" --check "$src_dir/gamenight-watch-pi.mjs" || die "the watch script does not parse on this Node"
ok "sources, Node, the bot token and #gm-bot are in place"

plan_files="install $dest"
cmp_all=1
for f in $files; do cmp -s "$src_dir/$f" "$dest/$f" 2>/dev/null || cmp_all=0; done
[ "$cmp_all" = 1 ] && plan_files="nothing to do"
plan_env="create the template"
[ -f "$watch_env" ] && plan_env="kept as it is"
plan_unit="write the unit"
[ -f "$unit_file" ] && [ "$(cat "$unit_file")" = "$want_unit" ] && plan_unit="nothing to do"
public="off"
if [ -f "$watch_env" ] && has_key "$watch_env" WATCH_PUBLIC_URL && has_key "$watch_env" CF_ACCESS_CLIENT_ID && has_key "$watch_env" CF_ACCESS_CLIENT_SECRET; then public="on"; fi
say "plan: files: $plan_files; settings file: $plan_env; unit: $plan_unit; public check: $public (names only, no values shown)"
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
  mark_changed "$dest/gamenight-watch.mjs" "$dest/gamenight-watch-pi.mjs"
  ok "installed $files in $dest"
fi
# The files come from the PC, not from the release build: SHA256SUMS lets the user compare them with the repo
# (git show aitool/main:scripts/gamenight-watch.mjs | sha256sum) and CHECK shows them again.
(cd "$dest" && sha256sum $files >SHA256SUMS)
chmod 0644 "$dest/SHA256SUMS"
sed 's/^/    /' "$dest/SHA256SUMS" || true

say "the settings file"
mkdir -p "$TOOL_ETC"
if [ -f "$watch_env" ]; then
  ok "$watch_env already there (kept as it is)"
else
  printf '%s\n' "$template" >"$watch_env"
  mark_changed "$watch_env"
  ok "wrote $watch_env from the template (public check off until the user fills it in)"
fi
chown "root:$FOUNDRY_USER" "$watch_env"
chmod 0640 "$watch_env"

say "the unit"
write_file "$unit_file" 0644 "$want_unit" || true

say "start"
if have_systemd; then
  systemctl daemon-reload
  systemctl enable "$unit" >/dev/null 2>&1
  if ! systemctl is-active --quiet "$unit"; then
    systemctl start "$unit"
  else
    # Restart when a file changed in this run, or is newer than the running service (a rerun after a cut-off upgrade: the
    # files were written, the restart never happened). Only the watch itself restarts; it holds no player and no recording.
    started="$(unit_started_epoch "$unit")"
    restart=0
    for f in "$unit_file" "$dest/gamenight-watch.mjs" "$dest/gamenight-watch-pi.mjs" "$watch_env"; do
      if file_changed "$f"; then
        restart=1
      elif [ -n "$started" ] && [ -f "$f" ] && [ "$(stat -c %Y "$f")" -gt "$started" ]; then
        restart=1
      fi
    done
    if [ "$restart" = 1 ]; then systemctl restart "$unit"; fi
  fi
  sleep 2
  systemctl is-active --quiet "$unit" || die "$unit did not start: journalctl -u $unit -n 30"
  ok "$unit running"
  journalctl -u "$unit" -n 3 --no-pager 2>/dev/null | sed 's/^/    /' || true
else
  warn "no systemd here (a test container?): files and unit written, nothing started"
fi

ok "next: with a session marked the watch posts \"Game-night watch started\" in #gm-bot; add the public address and the Access service token to $watch_env to switch the public check on"
say "stage 29 done"
