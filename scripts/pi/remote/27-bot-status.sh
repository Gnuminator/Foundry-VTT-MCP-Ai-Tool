#!/usr/bin/env bash
# Stage 27: switch on the recorder bot's status endpoint and point the dashboard at it (backlog pi-bot-status-endpoint,
# item health-line-dots). The GM health line then shows the Recorder dot (a speaker silent for 5 minutes, a failed audio
# stream, the bot unable to rejoin); without it the dot is absent.
#
# What it changes, nothing else:
#   1. the bot's settings file $TOOL_ETC/discord-bot.env: the one line FOUNDRY_AI_BOT_STATUS_PORT=<port> is set (replaced
#      when present, else added at the end). The file also holds the Discord token: it is never printed and its mode and
#      owner stay. The bot listens on 127.0.0.1 only (FOUNDRY_AI_BOT_STATUS_HOST is not set here).
#   2. a systemd drop-in for the dashboard, /etc/systemd/system/foundry-ai-tool-dashboard.service.d/bot-status.conf, with
#      Environment=DASHBOARD_BOT_STATUS_URL=http://127.0.0.1:<port>/status. A drop-in, not dashboard.env: stage 7 rewrites
#      dashboard.env whole, and stage 5 rewrites the unit file, so neither would keep the line.
#   3. restarts the two services when (and only when) something changed and they run: the bot first, then the dashboard.
#      A bot restart ends a Discord recording and a dashboard restart drops the open dashboard pages, so both go through
#      require_quiet (refuses while players are online or a recording runs; never run this on a game night).
#   4. the check: GET http://127.0.0.1:<port>/status must answer 200 with JSON; the top-level keys are shown, nothing else.
#      The dashboard's Recorder dot is then checked by eye (the GM health line).
# Before it writes anything it checks that the deployed bot build knows the status port and the dashboard build knows the
# URL setting (an older build ignores both settings: run stage 5, then stage 8 first).
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   UNDO=1     remove the bot line and the drop-in again (same restarts and guards)
#   PORT=3110  the status port (1024 to 65535); default 3110
# A real run (and UNDO) needs a dietpi-backup snapshot from today and the user's OK. These lines are bash:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/27-bot-status.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/27-bot-status.sh | ssh foundry-pi 'bash -s'
# Tests only: TOOL_ETC, TOOL_DIR and DROPIN_DIR_BASE point at stand-in folders.

dry="${DRY_RUN:-0}"
undo="${UNDO:-0}"
port="${PORT:-3110}"
bot_unit=foundry-ai-tool-discord-bot.service
dash_unit=foundry-ai-tool-dashboard.service
env_file="$TOOL_ETC/discord-bot.env"
dropin_dir="${DROPIN_DIR_BASE:-/etc/systemd/system}/$dash_unit.d"
dropin="$dropin_dir/bot-status.conf"
bot_build="$TOOL_DIR/discord-bot/dist"
dash_build="$TOOL_DIR/app/packages/cogm-dashboard/dist"

require_root
case "$port" in '' | *[!0-9]*) die "PORT must be a number, got '$port'" ;; esac
[ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || die "PORT must be between 1024 and 65535, got $port"
[ "$dry" = 1 ] || require_recent_snapshot

say "checking before anything is written"
[ -f "$env_file" ] || die "$env_file is missing: run stage 8 first"
if [ "$undo" != 1 ]; then
  [ -d "$bot_build" ] && grep -rqF FOUNDRY_AI_BOT_STATUS_PORT "$bot_build" ||
    die "the deployed bot build ($bot_build) does not know FOUNDRY_AI_BOT_STATUS_PORT: run stage 5 with a release that has it, then stage 8"
  [ -d "$dash_build" ] && grep -rqF DASHBOARD_BOT_STATUS_URL "$dash_build" ||
    die "the deployed dashboard build ($dash_build) does not know DASHBOARD_BOT_STATUS_URL: run stage 5 with a release that has it"
  ok "both deployed builds know the settings"
  # systemd lets an EnvironmentFile= value beat the drop-in's Environment=, so a URL already set in one of these files would
  # silently win over what this stage writes.
  for f in "$TOOL_ETC/dashboard.env" "$TOOL_ETC/dashboard-access.env"; do
    if [ -f "$f" ] && grep -qE '^[[:space:]]*DASHBOARD_BOT_STATUS_URL=' "$f"; then
      die "$f already sets DASHBOARD_BOT_STATUS_URL and would override the drop-in: remove that line first (nothing was changed)"
    fi
  done
fi

want_line="FOUNDRY_AI_BOT_STATUS_PORT=$port"
want_url="http://127.0.0.1:$port/status"
want_dropin="[Service]
# Written by scripts/pi/remote/27-bot-status.sh (edit it there): where the dashboard reads the recorder bot's status.
Environment=DASHBOARD_BOT_STATUS_URL=$want_url"

# The bot's current line, without printing the rest of the file (it holds the token).
cur_line="$(grep -E '^FOUNDRY_AI_BOT_STATUS_PORT=' "$env_file" | tail -n 1 || true)"
say "state before"
echo "    bot env line: ${cur_line:-none}"
echo "    dashboard drop-in: $([ -f "$dropin" ] && echo present || echo none)"

if [ "$undo" = 1 ]; then
  plan_env="remove the line"
  plan_dropin="remove the drop-in"
  [ -n "$cur_line" ] || plan_env="nothing to do"
  [ -f "$dropin" ] || plan_dropin="nothing to do"
else
  plan_env="set $want_line"
  [ "$cur_line" != "$want_line" ] || plan_env="nothing to do"
  plan_dropin="write the drop-in ($want_url)"
  [ ! -f "$dropin" ] || [ "$(cat "$dropin")" != "$want_dropin" ] || plan_dropin="nothing to do"
fi
say "plan: bot env: $plan_env; dashboard drop-in: $plan_dropin"
if [ "$dry" = 1 ]; then
  say "DRY_RUN=1: nothing changed"
  exit 0
fi

# The port must be free unless the bot already holds it (the bot listens only after a restart, so a changed port is checked now).
if [ "$undo" != 1 ] && [ "$plan_env" != "nothing to do" ] && command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$port\$"; then
    die "port $port is already in use on this Pi (ss -ltn): pick another with PORT=<n>"
  fi
fi

if [ "$plan_env" = "nothing to do" ] && [ "$plan_dropin" = "nothing to do" ] && [ "${RESTART_UNITS:-0}" != 1 ]; then
  ok "already set; nothing changed, no restart"
else
  # Both restarts are guarded before the first write: a refusal leaves everything as it was.
  require_quiet "restarting the recorder bot and the dashboard for the status endpoint"

  say "the bot's settings file"
  if [ "$plan_env" != "nothing to do" ]; then
    # A sibling temp file, then mv: a dropped connection never leaves the bot without its token. Owner and mode are copied
    # from the old file (root:foundry 0640). Nothing of the file is printed.
    tmp="$(mktemp "$(dirname "$env_file")/.discord-bot.env.XXXXXX")"
    trap 'rm -f "${tmp:?}"' EXIT
    { grep -vE '^FOUNDRY_AI_BOT_STATUS_PORT=' "$env_file" || true; } >"$tmp"
    if [ "$undo" != 1 ]; then printf '%s\n' "$want_line" >>"$tmp"; fi
    chown --reference="$env_file" "$tmp"
    chmod --reference="$env_file" "$tmp"
    mv "$tmp" "$env_file"
    trap - EXIT
    mark_changed "$env_file"
    ok "$env_file: $([ "$undo" = 1 ] && echo "status port line removed" || echo "$want_line")"
  else
    ok "$env_file already right"
  fi

  say "the dashboard drop-in"
  if [ "$undo" = 1 ]; then
    if [ -f "$dropin" ]; then
      rm -f "${dropin:?}"
      rmdir "$dropin_dir" 2>/dev/null || true
      mark_changed "$dropin"
      ok "removed $dropin"
    else
      ok "no drop-in"
    fi
  else
    mkdir -p "$dropin_dir"
    write_file "$dropin" 0644 "$want_dropin" || true
  fi

  say "restarts"
  if have_systemd; then
    systemctl daemon-reload
    # enable_unit restarts a running unit when its file or the settings file changed; a stopped bot (no token yet) stays
    # stopped: stage 8 and set-discord-token decide that, not this stage.
    if systemctl is-active --quiet "$bot_unit"; then
      enable_unit "$bot_unit" "$env_file"
    else
      warn "$bot_unit is not running (no token yet?): the setting is read when it starts"
    fi
    if systemctl is-active --quiet "$dash_unit"; then
      enable_unit "$dash_unit" "$dropin"
    else
      warn "$dash_unit is not running: the setting is read when it starts"
    fi
  else
    warn "no systemd here (a test container?): files written, nothing restarted"
  fi
fi

if [ "$undo" != 1 ]; then
  say "the check: GET $want_url"
  if have_systemd && systemctl is-active --quiet "$bot_unit"; then
    got=""
    for _ in $(seq 1 20); do
      got="$(curl -fs --max-time 3 "$want_url" 2>/dev/null || true)"
      [ -n "$got" ] && break
      sleep 1
    done
    if [ -n "$got" ] && keys="$(printf '%s' "$got" | "$NODE_DIR/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(!j||typeof j!=="object")process.exit(1);process.stdout.write(Object.keys(j).join(", "))}catch{process.exit(1)}})' 2>/dev/null)"; then
      ok "the bot answers with JSON; keys: $keys"
    else
      die "the bot does not answer JSON on $want_url: journalctl -u $bot_unit -n 20 (the setting is in place; UNDO=1 removes it)"
    fi
  else
    warn "the bot is not running: the endpoint was not checked"
  fi
  echo "    Recorder dot: open the GM dashboard, health line; with a recording running it should show nothing wrong (grey 'unknown' means the dashboard cannot reach the bot)."
fi

say "stage 27 done: status port $port ($([ "$undo" = 1 ] && echo removed || echo set))"
