#!/usr/bin/env bash
# Stage 23: move the Pi's Discord bot to the game server "D&D GUTTERNE" (backlog discord-pi-game-server). Until now the Pi's
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
#   3. when the four lines are already right it changes nothing; otherwise:
#      a snapshot from today is required, and a bot restart is refused while players are online in Foundry or a
#      recording runs (restarting the bot ends a recording; FORCE=1 overrides, with a warning);
#   4. copies the env file once to discord-bot.env.before-game-server (same owner and mode; it holds the token, so it
#      stays in /etc/foundry-ai-tool and is never copied elsewhere), writes the new file whole in one step and restarts
#      the bot;
#   5. the check: waits up to 30 s for "Logged in as" and "Registered /record in server <the game server id>" in the
#      bot's own journal lines (only those two lines are read, never the whole journal).
# Safe to run again. Nothing else on the Pi is touched.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print the state and what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    only the check (step 5) plus the four lines; changes nothing, exit 1 when something is off
#   UNDO=1     put the saved file back (the Silvera settings) and restart the bot; the saved copy stays
# A real run and UNDO need a dietpi-backup snapshot from today and the user's OK. These lines are bash (Git Bash, or
# Claude's Bash tool), not PowerShell:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/23-discord-game-server.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/23-discord-game-server.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/23-discord-game-server.sh | ssh foundry-pi 'CHECK=1 bash -s'
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
  if grep -Eq '^DISCORD_TOKEN=[^[:space:]]+' "$1"; then out "    DISCORD_TOKEN=<hidden>"; else out "    DISCORD_TOKEN is missing"; fi
}

lines_right() {
  [ "$(get "$env_file" DISCORD_GUILD_ID)" = "$guild_id" ] &&
    [ "$(get "$env_file" DISCORD_SESSION_POST_CHANNEL_ID)" = "$session_post_id" ] &&
    [ "$(get "$env_file" GAMENIGHT_WATCH_CHANNEL_ID)" = "$watch_id" ] &&
    [ "$(get "$env_file" DISCORD_CHANGELOG_CHANNEL_ID)" = "$changelog_id" ]
}

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
  ok "the four lines point at the game server"
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
  say "the saved file"
  show_state "$saved"
  want_guild="$(get "$saved" DISCORD_GUILD_ID)"
else
  want_guild="$guild_id"
fi

if [ "$dry" = 1 ]; then
  if [ "$undo" = 1 ]; then
    say "dry run: would put $saved back as $env_file and restart $unit; nothing changed"
  elif lines_right; then
    say "dry run: the four lines are already right; a real run changes nothing"
  else
    say "dry run: would set DISCORD_GUILD_ID=$guild_id DISCORD_SESSION_POST_CHANNEL_ID=$session_post_id GAMENIGHT_WATCH_CHANNEL_ID=$watch_id DISCORD_CHANGELOG_CHANNEL_ID=$changelog_id,"
    out "    save $saved (if there is none yet), restart $unit; nothing changed"
  fi
  exit 0
fi

if [ "$undo" != 1 ] && lines_right; then
  say "nothing to do"
  ok "the four lines already point at the game server; the bot is not touched (CHECK=1 checks it)"
  exit 0
fi

# Everything below changes the Pi: snapshot first, then the quiet check, both before a file is written.
require_recent_snapshot
require_quiet_if_active "$unit" "restarting the Discord bot (it would end a recording)"

since="$(date '+%Y-%m-%d %H:%M:%S')"
tmp="$(mktemp "$(dirname "$env_file")/.discord-bot.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
owner_group="root:$FOUNDRY_USER"
id "$FOUNDRY_USER" >/dev/null 2>&1 || owner_group="$(stat -c '%U:%G' "$env_file")"

if [ "$undo" = 1 ]; then
  say "putting the saved file back"
  cp "$saved" "$tmp"
else
  say "the settings file"
  if [ ! -f "$saved" ]; then
    cp -p "$env_file" "$saved"
    chown "$owner_group" "$saved"
    chmod 0640 "$saved"
    ok "saved the current file as $saved (it holds the token: stays here)"
  else
    ok "$saved already exists: kept (it is the Silvera-era file undo returns to)"
  fi
  # The values go to awk through its environment; the token line passes through untouched.
  G="$guild_id" S="$session_post_id" W="$watch_id" C="$changelog_id" awk '
    function want(k) { return k == "DISCORD_GUILD_ID" ? ENVIRON["G"] : k == "DISCORD_SESSION_POST_CHANNEL_ID" ? ENVIRON["S"] : k == "GAMENIGHT_WATCH_CHANNEL_ID" ? ENVIRON["W"] : ENVIRON["C"] }
    /^(DISCORD_GUILD_ID|DISCORD_SESSION_POST_CHANNEL_ID|GAMENIGHT_WATCH_CHANNEL_ID|DISCORD_CHANGELOG_CHANNEL_ID)=/ {
      k = $0; sub(/=.*/, "", k)
      if (!(k in seen)) { print k "=" want(k); seen[k] = 1 }
      next
    }
    { print }
    END {
      n = split("DISCORD_GUILD_ID DISCORD_SESSION_POST_CHANNEL_ID GAMENIGHT_WATCH_CHANNEL_ID DISCORD_CHANGELOG_CHANNEL_ID", keys, " ")
      for (i = 1; i <= n; i++) if (!(keys[i] in seen)) print keys[i] "=" want(keys[i])
    }
  ' "$env_file" >"$tmp"
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
if [ "$undo" = 1 ]; then say "done: the bot is back on the earlier server"; else say "done: the bot answers /record on the game server"; fi
