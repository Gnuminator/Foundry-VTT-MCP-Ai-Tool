#!/usr/bin/env bash
# Puts the recorder bot's token (and optionally the Discord server id) into
# /etc/foundry-ai-tool/discord-bot.env and starts the bot. Not run by hand: the user runs
# scripts/pi/set-discord-token.ps1 on the PC, which asks for the token without showing it and sends
# lib.sh, the two values (TOKEN_IN, GUILD_IN) and this file to `ssh foundry-pi 'bash -s -- no-log'` on stdin,
# so the token never appears on a command line, in a file on the PC or in Claude's chat.
# Other lines in the env file stay as they are. An empty GUILD_IN keeps the server id already there.

require_root
env_file="$TOOL_ETC/discord-bot.env"
unit=foundry-ai-tool-discord-bot.service
[ -f "$env_file" ] || die "$env_file is missing: run stage 8 (8-recorder.sh) first"
[ -n "${TOKEN_IN:-}" ] || die "no token given"
printf '%s' "$TOKEN_IN" | grep -Eq '^[A-Za-z0-9._-]{50,100}$' ||
  die "that does not look like a Discord bot token (letters, digits, dots, dashes, 50 to 100 characters)"
if [ -n "${GUILD_IN:-}" ]; then
  printf '%s' "$GUILD_IN" | grep -Eq '^[0-9]{15,22}$' || die "the server id must be 15 to 22 digits"
fi

say "the settings file"
tmp="$(mktemp "$TOOL_ETC/.discord-bot.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
# The values go to awk through its environment, not its arguments (other users can read arguments).
T="$TOKEN_IN" G="${GUILD_IN:-}" awk '
  /^DISCORD_TOKEN=/ { print "DISCORD_TOKEN=" ENVIRON["T"]; t = 1; next }
  /^DISCORD_GUILD_ID=/ { if (ENVIRON["G"] != "") print "DISCORD_GUILD_ID=" ENVIRON["G"]; else print; g = 1; next }
  { print }
  END {
    if (!t) print "DISCORD_TOKEN=" ENVIRON["T"]
    if (!g && ENVIRON["G"] != "") print "DISCORD_GUILD_ID=" ENVIRON["G"]
  }
' "$env_file" >"$tmp"
chown "root:$FOUNDRY_USER" "$tmp"
chmod 0640 "$tmp"
mv "$tmp" "$env_file"
trap - EXIT
ok "token written to $env_file (not shown)"
if grep -Eq '^DISCORD_GUILD_ID=[0-9]+' "$env_file"; then
  ok "server id: $(sed -n 's/^DISCORD_GUILD_ID=//p' "$env_file" | tail -n 1)"
else
  ok "no server id: /record registers globally (can take up to an hour to show)"
fi

say "the bot"
[ -f "/etc/systemd/system/$unit" ] || die "$unit is missing: run stage 8 (8-recorder.sh) first"
since="$(date '+%Y-%m-%d %H:%M:%S')"
enable_unit "$unit"
# Only the bot's own login line; never the whole journal (a library could print the token).
for _ in $(seq 1 30); do
  journalctl -u "$unit" --since "$since" --no-pager -o cat 2>/dev/null | grep -q 'Logged in as' && break
  sleep 1
done
if journalctl -u "$unit" --since "$since" --no-pager -o cat 2>/dev/null | grep -q 'Logged in as'; then
  ok "$(journalctl -u "$unit" --since "$since" --no-pager -o cat | grep -m 1 -o 'Logged in as .*')"
  journalctl -u "$unit" --since "$since" --no-pager -o cat | grep -m 1 -o 'Registered /record .*' || true
else
  warn "the bot runs but has not logged in after 30 s; ask Claude to check: journalctl -u $unit -n 20"
fi
say "done: the bot answers /record in Discord"
