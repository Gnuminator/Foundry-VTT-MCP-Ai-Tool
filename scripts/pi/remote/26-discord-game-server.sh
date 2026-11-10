#!/usr/bin/env bash
# Stage 26: move the Pi's Discord bot to the game server "D&D GUTTERNE" (backlog discord-pi-game-server). Until now the Pi's
# bot (/etc/foundry-ai-tool/discord-bot.env) points at Silvera's old test server; /record and the "session is over" post
# must work on the game server for the recorded character session (Sunday 2026-11-08 10:00).
#
# It sets these lines in the env file (other lines, the token above all, stay as they are and are never printed):
#   DISCORD_GUILD_ID                  1432040202687348856  the game server: /record registers there at once
#   DISCORD_SESSION_POST_CHANNEL_ID   #session-notes       the "session is over" post
#   GAMENIGHT_WATCH_CHANNEL_ID        #gm-bot              the game-night watch's alerts
#   DISCORD_CHANGELOG_CHANNEL_ID      #changelog           one line per Pi deploy of a new release (announce.mjs)
# The ids are not secrets (vault Design/Discord server reset 2026-11-02, Applied). Each can be overridden in the
# environment (GUILD_ID, SESSION_POST_CHANNEL_ID, WATCH_CHANNEL_ID, CHANGELOG_CHANNEL_ID) and must be 15 to 22 digits.
# The bot token is the same bot that already sits in the game server (checked read-only from the PC, 2026-11-04).
#
# What it does, in this order, and stops before the next step when one fails:
#   1. refuses unless the env file and the bot's service exist (stage 8 ran);
#   2. reads the state (key names and ids only, the token line shown as <hidden>) and prints what would change;
#   The session-over post also needs FOUNDRY_AI_PLAYER_PAGE_URL (the link players open; the bot keeps the post off without
#   it) and FOUNDRY_AI_DASHBOARD_URL (the Pi's dashboard is on port 3000, the bot's default is 3100). Give
#   PLAYER_PAGE_URL=https://... (no query or token) to set the first and, with it, DASHBOARD_URL (default
#   http://127.0.0.1:3000). Without it an existing link is kept and the stage warns when there is none.
#   3. when the lines are already right the file is not changed, but a bot that started before the file was written (a
#      run cut off before its restart) is restarted (and its /record registration checked), so a rerun finishes the job;
#      otherwise:
#      a snapshot from today is required, and a bot restart is refused while players are online in Foundry or a
#      recording runs (restarting the bot ends a recording; FORCE=1 overrides, with a warning);
#   4. copies the env file once to discord-bot.env.before-game-server (through a temp file and mv; same owner and mode; it
#      holds the token, so it stays in /etc/foundry-ai-tool and is never copied elsewhere), writes the new file whole in
#      one step and restarts the bot;
#   5. the check: waits up to 30 s for "Logged in as" and "Registered /record in server <the game server id>" in the
#      bot's own journal lines (only those two lines are read, never the whole journal).
# Safe to run again. Nothing else on the Pi is touched.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print the state and what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    only the check (step 5) plus the four lines; changes nothing, exit 1 when something is off
#   UNDO=1     put the keys the stage set back to their saved values (the Silvera settings; a key the saved file lacks is
#              removed) and restart the bot; every other line, a token changed since included, stays as it is now. The
#              saved copy stays
# A real run and UNDO need a dietpi-backup snapshot from today and the user's OK. These lines are bash (Git Bash, or
# Claude's Bash tool), not PowerShell:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/26-discord-game-server.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/26-discord-game-server.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/26-discord-game-server.sh | ssh foundry-pi 'CHECK=1 bash -s'
# Tests only: DISCORD_ENV_FILE points at a stand-in file, WAIT_SECONDS shortens the wait.

dry="${DRY_RUN:-0}"
check_only="${CHECK:-0}"
undo="${UNDO:-0}"
env_file="${DISCORD_ENV_FILE:-$TOOL_ETC/discord-bot.env}"
saved="$env_file.before-game-server"
unit=foundry-ai-tool-discord-bot.service
wait_seconds="${WAIT_SECONDS:-30}"

guild_id="${GUILD_ID:-1432040202687348856}"
session_post_id="${SESSION_POST_CHANNEL_ID:-1566876400147759394}"
watch_id="${WATCH_CHANNEL_ID:-1566876401519427755}"
changelog_id="${CHANGELOG_CHANNEL_ID:-1566884650494722220}"

for v in "$guild_id" "$session_post_id" "$watch_id" "$changelog_id"; do
  printf '%s' "$v" | grep -Eq '^[0-9]{15,22}$' || die "an id must be 15 to 22 digits (got a value of ${#v} characters)"
done
wanted="DISCORD_GUILD_ID=$guild_id
DISCORD_SESSION_POST_CHANNEL_ID=$session_post_id
GAMENIGHT_WATCH_CHANNEL_ID=$watch_id
DISCORD_CHANGELOG_CHANNEL_ID=$changelog_id"
if [ -n "${PLAYER_PAGE_URL:-}" ]; then
  printf '%s' "$PLAYER_PAGE_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$' ||
    die "PLAYER_PAGE_URL must be an https address without a query or token (for example https://cogm.example.com/player)"
  dash_url="${DASHBOARD_URL:-http://127.0.0.1:3000}"
  printf '%s' "$dash_url" | grep -Eq '^http://(127\.0\.0\.1|localhost):[0-9]+$' || die "DASHBOARD_URL must be http://127.0.0.1:<port>"
  wanted="$wanted
FOUNDRY_AI_PLAYER_PAGE_URL=$PLAYER_PAGE_URL
FOUNDRY_AI_DASHBOARD_URL=$dash_url"
fi
[ "$((dry + check_only + undo))" -le 1 ] || die "DRY_RUN, CHECK and UNDO are separate modes: set one"

require_root
[ -f "$env_file" ] || die "$env_file is missing: run stage 8 (8-recorder.sh) first"
if [ -z "${DISCORD_ENV_FILE:-}" ]; then
  [ -f "/etc/systemd/system/$unit" ] || die "$unit is missing: run stage 8 (8-recorder.sh) first"
fi

get() { # get FILE KEY: the last value of KEY in FILE (empty when absent)
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1 | tr -d '\r'
}

show_state() { # show_state FILE
  local k
  for k in DISCORD_GUILD_ID DISCORD_SESSION_POST_CHANNEL_ID GAMENIGHT_WATCH_CHANNEL_ID DISCORD_CHANGELOG_CHANNEL_ID; do
    out "    $k=$(get "$1" "$k")"
  done
  # Names only: the page link may carry a token.
  for k in FOUNDRY_AI_PLAYER_PAGE_URL FOUNDRY_AI_DASHBOARD_URL; do
    if [ -n "$(get "$1" "$k")" ]; then out "    $k is set"; else out "    $k is not set"; fi
  done
  if grep -Eq '^DISCORD_TOKEN=[^[:space:]]+' "$1"; then out "    DISCORD_TOKEN=<hidden>"; else out "    DISCORD_TOKEN is missing"; fi
}

lines_right() { # every wanted KEY=VALUE is the last such line in the file
  local pair
  while IFS= read -r pair; do
    [ "$(get "$env_file" "${pair%%=*}")" = "${pair#*=}" ] || return 1
  done <<<"$wanted"
}

# The session-over post (bot.ts) stays off unless FOUNDRY_AI_PLAYER_PAGE_URL is set, and the bot reads the session flag
# from FOUNDRY_AI_DASHBOARD_URL (default port 3100, the Pi's dashboard is on 3000). Without a PLAYER_PAGE_URL here, an
# existing page link is kept; with neither, the post is off and the stage says so.
post_note() {
  if [ -z "$(get "$env_file" FOUNDRY_AI_PLAYER_PAGE_URL)" ]; then
    warn "FOUNDRY_AI_PLAYER_PAGE_URL is not set: the bot will NOT post the session-over link in #session-notes. Rerun with PLAYER_PAGE_URL=https://... (no ?token=)"
  fi
  case "$(get "$env_file" FOUNDRY_AI_DASHBOARD_URL)" in
    http://127.0.0.1:3000 | http://localhost:3000) ;;
    *) warn "FOUNDRY_AI_DASHBOARD_URL is not set to the Pi's dashboard (port 3000; the bot's default is 3100): the bot would read the session flag from the wrong port. Rerun with PLAYER_PAGE_URL=https://... to set it" ;;
  esac
}

# The keys this stage sets (the four ids and, with PLAYER_PAGE_URL, the two addresses). UNDO touches only these.
STAGE_KEYS="DISCORD_GUILD_ID DISCORD_SESSION_POST_CHANNEL_ID GAMENIGHT_WATCH_CHANNEL_ID DISCORD_CHANGELOG_CHANNEL_ID FOUNDRY_AI_PLAYER_PAGE_URL FOUNDRY_AI_DASHBOARD_URL"

# The check: the bot's own login and /record lines since SINCE (a journal timestamp); the token is never in these lines.
check_bot() { # check_bot SINCE
  local since="$1" want="$2" i=0 line=""
  have_systemd || {
    warn "no systemd here (a test container?): the bot is not checked"
    return 0
  }
  while [ "$i" -lt "$wait_seconds" ]; do
    line="$(journalctl -u "$unit" --since "$since" --no-pager -o cat 2>/dev/null | grep -m 1 -o "Registered /record in server $want" || true)"
    [ -z "$line" ] || break
    i=$((i + 1))
    sleep 1
  done
  [ -n "$line" ] || return 1
  journalctl -u "$unit" --since "$since" --no-pager -o cat 2>/dev/null | grep -m 1 -o 'Logged in as .*' || true
  out "    $line"
}

say "state before ($env_file)"
show_state "$env_file"

if [ "$check_only" = 1 ]; then
  say "check"
  lines_right || die "the four lines are not the game server's (see above); run the stage"
  ok "the lines point at the game server"
  post_note
  if have_systemd; then
    systemctl is-active --quiet "$unit" || die "$unit is not running"
    ok "$unit running"
    since="$(date -d "@$(unit_started_epoch "$unit")" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d '-1 hour' '+%Y-%m-%d %H:%M:%S')"
    check_bot "$since" "$guild_id" || die "the bot has not registered /record in the game server since it started; ask Claude to check: journalctl -u $unit -n 20"
  fi
  say "done: the bot is on the game server"
  exit 0
fi

if [ "$undo" = 1 ]; then
  [ -f "$saved" ] || die "no saved copy at $saved: nothing to undo (the stage has not changed this Pi, or the copy was removed)"
  # grep exits 2 on a file it cannot read, which the key loop below would read as "key absent" and drop all six keys. [ -r ]
  # says nothing as root (this stage runs as root), so ask grep itself: 0 or 1 is a readable file, anything else stops here.
  rc=0
  grep -q '' "$saved" 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || die "the saved copy $saved cannot be read by grep: nothing was changed (check its owner and mode)"
  say "the saved file"
  show_state "$saved"
  want_guild="$(get "$saved" DISCORD_GUILD_ID)"
else
  want_guild="$guild_id"
fi

if [ "$dry" = 1 ]; then
  if [ "$undo" = 1 ]; then
    say "dry run: would set the stage's six keys in $env_file back to their values in $saved (a key the saved file lacks is removed; every other line, the token included, stays as it is now) and restart $unit; nothing changed"
  elif lines_right; then
    say "dry run: the lines are already right; a real run changes no setting (it still restarts a bot older than the file)"
  else
    say "dry run: would set (names and ids only):"
    while IFS= read -r pair; do
      case "${pair%%=*}" in FOUNDRY_AI_PLAYER_PAGE_URL) out "    FOUNDRY_AI_PLAYER_PAGE_URL (the given address)" ;; *) out "    $pair" ;; esac
    done <<<"$wanted"
    out "    save $saved (if there is none yet), restart $unit; nothing changed"
  fi
  [ "$undo" = 1 ] || post_note
  exit 0
fi

if [ "$undo" != 1 ] && lines_right; then
  say "the lines are already right"
  ok "the settings file needs no change"
  # A run that wrote the file but was cut off before the restart (a refusal, a dropped connection) must still restart the
  # bot: enable_unit restarts a running unit only when the file is newer than the service, so a clean rerun is a no-op.
  if have_systemd; then
    # enable_unit asks require_quiet itself when (and only when) it restarts, so a clean rerun is never refused.
    since="$(date '+%Y-%m-%d %H:%M:%S')"
    started_before="$(unit_started_epoch "$unit")"
    enable_unit "$unit" "$env_file"
    if [ "$(unit_started_epoch "$unit")" != "$started_before" ]; then
      check_bot "$since" "$guild_id" ||
        warn "the bot was restarted but has not registered /record in server $guild_id after ${wait_seconds} s; ask Claude to check: journalctl -u $unit -n 20"
    fi
  fi
  post_note
  exit 0
fi

# Everything below changes the Pi: snapshot first, then the quiet check, both before a file is written.
require_recent_snapshot
require_quiet_if_active "$unit" "restarting the Discord bot (it would end a recording)"

since="$(date '+%Y-%m-%d %H:%M:%S')"
tmp="$(mktemp "$(dirname "$env_file")/.discord-bot.env.XXXXXX")"
tmp_saved=""
trap 'rm -f "${tmp:?}" ${tmp_saved:+"$tmp_saved"}' EXIT
owner_group="root:$FOUNDRY_USER"
id "$FOUNDRY_USER" >/dev/null 2>&1 || owner_group="$(stat -c '%U:%G' "$env_file")"

# set_keys: rewrites $env_file into $tmp with WANTED (KEY=VALUE lines) in place of the managed keys, and DROP (space separated
# keys) removed. Every other line, the token above all, passes through untouched; the values reach awk through its environment.
set_keys() {
  WANTED="$1" DROP="$2" awk '
    BEGIN {
      n = split(ENVIRON["WANTED"], pairs, "\n")
      for (i = 1; i <= n; i++) { k = pairs[i]; if (k == "") continue; sub(/=.*/, "", k); order[i] = k; val[k] = substr(pairs[i], length(k) + 2) }
      m = split(ENVIRON["DROP"], dk, " ")
      for (i = 1; i <= m; i++) drop[dk[i]] = 1
    }
    {
      k = $0; sub(/=.*/, "", k)
      if ($0 ~ /^[A-Z_]+=/ && (k in drop)) next
      if ($0 ~ /^[A-Z_]+=/ && (k in val)) {
        if (!(k in seen)) { print k "=" val[k]; seen[k] = 1 }
        next
      }
      print
    }
    END { for (i = 1; i <= n; i++) if (order[i] != "" && !(order[i] in seen)) print order[i] "=" val[order[i]] }
  ' "$env_file" >"$tmp"
}

if [ "$undo" = 1 ]; then
  # Only the keys this stage sets go back to their saved values (a key the saved file lacks is removed); a token or any other
  # line changed since the stage ran stays as it is now.
  say "putting the stage's keys back to the saved values"
  restore="" drop=""
  for k in $STAGE_KEYS; do
    rc=0
    grep -q "^$k=" "$saved" || rc=$?
    case "$rc" in
      0) restore="${restore:+$restore
}$k=$(get "$saved" "$k")" ;;
      1) drop="${drop:+$drop }$k" ;;
      *) die "grep could not read the saved copy $saved (key $k): nothing was changed" ;;
    esac
  done
  set_keys "$restore" "$drop"
else
  say "the settings file"
  if [ ! -f "$saved" ]; then
    # Temp file in the same folder, then mv: a dropped connection never leaves a half saved copy that undo would trust.
    tmp_saved="$(mktemp "$(dirname "$saved")/.discord-bot.env.saved.XXXXXX")"
    cp -p "$env_file" "$tmp_saved"
    chown "$owner_group" "$tmp_saved"
    chmod 0640 "$tmp_saved"
    mv "$tmp_saved" "$saved"
    tmp_saved=""
    ok "saved the current file as $saved (it holds the token: stays here)"
  else
    ok "$saved already exists: kept (it holds the Silvera-era values undo returns the stage's keys to)"
  fi
  set_keys "$wanted" ""
fi
chown "$owner_group" "$tmp"
chmod 0640 "$tmp"
mv "$tmp" "$env_file"
trap - EXIT
mark_changed "$env_file"
ok "$env_file written (the token line is untouched, not shown)"
show_state "$env_file"

say "the bot"
enable_unit "$unit" "$env_file"
if [ -n "$want_guild" ]; then
  check_bot "$since" "$want_guild" ||
    warn "the bot runs but has not registered /record in server $want_guild after ${wait_seconds} s; ask Claude to check: journalctl -u $unit -n 20"
else
  warn "the file has no DISCORD_GUILD_ID: /record registers globally (can take up to an hour)"
fi
# The game-night watch (stage 29) posts to the channel this file names: restart it (also when it stopped on exit 2 for an
# old channel) so a changed #gm-bot line reaches it. It holds no recording and no player, so no quiet check.
watch_unit=foundry-ai-tool-gamenight-watch.service
if have_systemd && [ -f "/etc/systemd/system/$watch_unit" ]; then
  systemctl restart "$watch_unit" && ok "restarted $watch_unit for the changed settings" || warn "could not restart $watch_unit: journalctl -u $watch_unit -n 20"
fi
if [ "$undo" = 1 ]; then
  say "done: the bot is back on the earlier server"
else
  post_note
  say "done: the bot answers /record on the game server"
fi
