#!/usr/bin/env bash
# Pi stage 26 (scripts/pi/remote/26-discord-game-server.sh, discord-pi-game-server) in a Debian 13 ARM64 container with the
# real lib.sh and the real awk/sed/stat (no systemd here: nothing restarts, the bot check is skipped). Scenarios:
#   1 refusals before anything is touched: a bad id, two modes at once, a missing env file, UNDO without a saved copy
#   2 DRY_RUN changes nothing and makes no saved copy
#   3 a real run: the four lines are set, the old guild is gone, other lines and the token stay, the token is never
#     printed, the old file is saved with its mode, the new file is root:foundry 0640
#   4 a rerun changes nothing and keeps the saved copy as it was
#   5 CHECK exits 0 when right and 1 when the lines are wrong
#   6 a file without the four lines gets them appended; duplicate lines collapse to one
#   7 the snapshot rule: a stale snapshot refuses before the file is written; a snapshot from today allows it
#   8 UNDO puts the stage's keys back to the saved values and keeps the copy
#   9 the session-over post settings (page link, dashboard address, warnings when they are missing or not port 3000)
#  10 a run cut off before the restart: a rerun restarts a bot older than the file and checks /record again
#  11 UNDO rewrites only the keys the stage set: a token changed since stays; the saved copy comes through a temp file
#     (no temp file is left behind)
#  12 (inside scenario 10's fake systemd) players online: a clean rerun is not refused (it restarts nothing); a rerun that
#     needs the restart is refused with "player(s) are online" and leaves the bot alone
#  13 UNDO branches on grep's own exit status (0 restore, 1 drop, else stop): a grep stand-in that exits 2 for the saved
#     copy (an unreadable file cannot be made as root) stops it with the env file unchanged and no temp file left
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage26-scenarios.sh
# (scripts/pi/discord-game-server.test.mjs runs it with PI_STAGE26_CONTAINER=1.) STAGE=<file> runs the scenarios against
# another copy of the script.
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_test_container


STAGE="${STAGE:-/repo/scripts/pi/remote/26-discord-game-server.sh}"
LIB=/repo/scripts/pi/remote/lib.sh

FOUNDRY_USER=foundry
TOOL_ETC=/etc/foundry-ai-tool
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
install -d -m 0750 -o root -g "$FOUNDRY_USER" "$TOOL_ETC"
env_file="$TOOL_ETC/discord-bot.env"
unit_file=/etc/systemd/system/foundry-ai-tool-discord-bot.service
mkdir -p /etc/systemd/system && : >"$unit_file"
saved="$env_file.before-game-server"
token="FAKEtoken.0123456789abcdefghijklmnopqrstuvwxyz.ABCDEFGHIJKLMNOPQRSTUVWX"
guild=1432040202687348856
session_post=1566876400147759394
watch=1566876401519427755
changelog=1566884650494722220
silvera=1554950241315459143

fresh_env() {
  rm -f "$env_file" "$saved"
  cat >"$env_file" <<EOF
# The recorder bot's settings
DISCORD_TOKEN=$token

DISCORD_GUILD_ID=$silvera
FVTT_SESSIONS_DIR=/var/lib/foundry-ai-tool/recordings
EOF
  chown "root:$FOUNDRY_USER" "$env_file"
  chmod 0640 "$env_file"
}

# run [VAR=value ...]: the stage as the user runs it (lib.sh and the stage on one stdin), output and exit code on stdout.
run() {
  local code
  OUT="$(cat "$LIB" "$STAGE" | env "$@" bash -s 2>&1)"
  code=$?
  return "$code"
}
get() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }
count() { grep -c "^$1=" "$env_file"; }

# 1.
fresh_env
before="$(sha256sum <"$env_file")"
run GUILD_ID=notanumber
rc=$?
if [ "$rc" -ne 0 ] && [ "$(sha256sum <"$env_file")" = "$before" ]; then pass "a bad id is refused, the file stays"; else fail "bad id: rc=$rc $OUT"; fi
run DRY_RUN=1 UNDO=1
rc=$?
if [ "$rc" -ne 0 ]; then pass "two modes are refused"; else fail "two modes: $OUT"; fi
run UNDO=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'nothing to undo'; then pass "UNDO without a saved copy is refused"; else fail "undo without copy: rc=$rc $OUT"; fi
mv "$env_file" "$env_file.gone"
run DRY_RUN=1
rc=$?
mv "$env_file.gone" "$env_file"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'stage 8'; then pass "a missing env file points at stage 8"; else fail "missing env: rc=$rc $OUT"; fi

mv "$unit_file" "$unit_file.gone"
run DRY_RUN=1
rc=$?
mv "$unit_file.gone" "$unit_file"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'stage 8'; then pass "a missing bot service points at stage 8"; else fail "missing unit: rc=$rc $OUT"; fi

# 2.
before="$(sha256sum <"$env_file")"
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ "$(sha256sum <"$env_file")" = "$before" ] && [ ! -e "$saved" ] && echo "$OUT" | grep -q 'would set (names and ids only)'; then
  pass "DRY_RUN says what it would do and changes nothing"; else fail "dry run: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$token"; then pass "the dry run does not print the token"; else fail "token in dry run output"; fi

# 3.
cp -p "$env_file" /tmp/original.env
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(get DISCORD_GUILD_ID)" = "$guild" ] && [ "$(get DISCORD_SESSION_POST_CHANNEL_ID)" = "$session_post" ] &&
  [ "$(get GAMENIGHT_WATCH_CHANNEL_ID)" = "$watch" ] && [ "$(get DISCORD_CHANGELOG_CHANNEL_ID)" = "$changelog" ]; then
  pass "the four lines are set"; else fail "run: rc=$rc $OUT; file: $(sed "s/^DISCORD_TOKEN=.*/DISCORD_TOKEN=<h>/" "$env_file")"; fi
if ! grep -q "$silvera" "$env_file" && [ "$(count DISCORD_GUILD_ID)" = 1 ]; then pass "the old guild is gone"; else fail "old guild left"; fi
if [ "$(get DISCORD_TOKEN)" = "$token" ] && grep -q '^FVTT_SESSIONS_DIR=/var/lib/foundry-ai-tool/recordings$' "$env_file" && grep -q '^# The recorder' "$env_file"; then
  pass "the token, the comment and other lines stay"; else fail "other lines changed"; fi
if ! echo "$OUT" | grep -q "$token"; then pass "the token is never printed"; else fail "token printed"; fi
if cmp -s "$saved" /tmp/original.env; then pass "the old file is saved unchanged"; else fail "saved copy differs"; fi
if [ "$(stat -c '%a %U:%G' "$env_file")" = "640 root:$FOUNDRY_USER" ] && [ "$(stat -c '%a %U:%G' "$saved")" = "640 root:$FOUNDRY_USER" ]; then
  pass "both files are 0640 root:$FOUNDRY_USER"; else fail "modes: $(stat -c '%a %U:%G' "$env_file") / $(stat -c '%a %U:%G' "$saved")"; fi
if ls "$TOOL_ETC"/.discord-bot.env.* >/dev/null 2>&1; then fail "a temp file is left behind"; else pass "no temp file left"; fi

# 4.
before="$(sha256sum <"$env_file")"
saved_before="$(sha256sum <"$saved")"
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(sha256sum <"$env_file")" = "$before" ] && [ "$(sha256sum <"$saved")" = "$saved_before" ] && echo "$OUT" | grep -q 'needs no change'; then
  pass "a rerun changes nothing and keeps the saved copy"; else fail "rerun: rc=$rc $OUT"; fi

# 5.
run CHECK=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "CHECK passes when the lines are right"; else fail "check right: rc=$rc $OUT"; fi
sed -i "s/^GAMENIGHT_WATCH_CHANNEL_ID=.*/GAMENIGHT_WATCH_CHANNEL_ID=1555839652965912576/" "$env_file"
run CHECK=1
rc=$?
if [ "$rc" -eq 1 ]; then pass "CHECK exits 1 when a line is wrong"; else fail "check wrong: rc=$rc $OUT"; fi

# 6.
fresh_env
printf 'DISCORD_SESSION_POST_CHANNEL_ID=111111111111111111\nDISCORD_SESSION_POST_CHANNEL_ID=222222222222222222\n' >>"$env_file"
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(count DISCORD_SESSION_POST_CHANNEL_ID)" = 1 ] && [ "$(get DISCORD_SESSION_POST_CHANNEL_ID)" = "$session_post" ] &&
  [ "$(count GAMENIGHT_WATCH_CHANNEL_ID)" = 1 ] && [ "$(count DISCORD_CHANGELOG_CHANNEL_ID)" = 1 ]; then
  pass "missing lines are appended, duplicates collapse"; else fail "append/dedupe: rc=$rc $OUT"; fi

# 7.
fresh_env
mkdir -p /tmp/fakedietpi
echo "2020-01-01_01:25:00  Backup completed" >/tmp/stats
before="$(sha256sum <"$env_file")"
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -ne 0 ] && [ "$(sha256sum <"$env_file")" = "$before" ] && [ ! -e "$saved" ]; then pass "a stale snapshot refuses before anything is written"; else fail "stale snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "DRY_RUN needs no snapshot"; else fail "dry run with stale snapshot: rc=$rc $OUT"; fi
echo "$(date +%F)_09:00:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -eq 0 ] && [ "$(get DISCORD_GUILD_ID)" = "$guild" ]; then pass "a snapshot from today allows the run"; else fail "fresh snapshot: rc=$rc $OUT"; fi

# 8.
run UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && grep -q "^DISCORD_GUILD_ID=$silvera$" "$env_file" && ! grep -q 'DISCORD_SESSION_POST_CHANNEL_ID' "$env_file" && [ -e "$saved" ]; then
  pass "UNDO puts the stage's keys back to the saved values and keeps the copy"; else fail "undo: rc=$rc $OUT"; fi
if [ "$(stat -c '%a %U:%G' "$env_file")" = "640 root:$FOUNDRY_USER" ]; then pass "the restored file is 0640 root:$FOUNDRY_USER"; else fail "restored mode"; fi

# 9. The session-over post settings.
fresh_env
run PLAYER_PAGE_URL='https://x.example.com/player?token=abc'
rc=$?
if [ "$rc" -ne 0 ] && [ "$(get DISCORD_GUILD_ID)" = "$silvera" ]; then pass "a page link with a query is refused, nothing written"; else fail "query url: rc=$rc $OUT"; fi
run
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'will NOT post the session-over link'; then pass "no page link: the stage warns the post is off"; else fail "no-link warning: rc=$rc $OUT"; fi
run PLAYER_PAGE_URL=https://cogm.example.com/player
rc=$?
if [ "$rc" -eq 0 ] && [ "$(get FOUNDRY_AI_PLAYER_PAGE_URL)" = "https://cogm.example.com/player" ] && [ "$(get FOUNDRY_AI_DASHBOARD_URL)" = "http://127.0.0.1:3000" ] &&
  ! echo "$OUT" | grep -q 'cogm.example.com' && ! echo "$OUT" | grep -q 'will NOT post'; then
  pass "the page link and the dashboard address are set, the link is not printed"; else fail "page url: rc=$rc $OUT"; fi
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(get FOUNDRY_AI_PLAYER_PAGE_URL)" = "https://cogm.example.com/player" ] && ! echo "$OUT" | grep -q 'will NOT post'; then
  pass "a rerun without the link keeps it"; else fail "keep link: rc=$rc $OUT"; fi

# 10. A run cut off before the restart: a rerun restarts a bot older than the file (stand-in systemd).
fresh_env
mkdir -p /run/systemd/system /tmp/sd/bin
cat >/tmp/sd/bin/systemctl <<'SH'
#!/usr/bin/env bash
echo "$*" >>/tmp/sd/calls
case "$1" in
  is-active)
    case "${@: -1}" in
      foundry-ai-tool-discord-bot.service) [ -f /tmp/sd/active ] ;;
      foundry.service) [ -f /tmp/sd/foundry ] ;;
      *) false ;;
    esac ;;
  show) cat /tmp/sd/ts 2>/dev/null ;;
  restart | start) : >/tmp/sd/active; date -u '+%F %T UTC' >/tmp/sd/ts ;;
esac
SH
cat >/tmp/sd/bin/journalctl <<SH
#!/usr/bin/env bash
echo "Logged in as bot#0001"
echo "Registered /record in server $guild"
SH
chmod +x /tmp/sd/bin/systemctl /tmp/sd/bin/journalctl
: >/tmp/sd/active
echo "2020-01-01 00:00:00 UTC" >/tmp/sd/ts
: >/tmp/sd/calls
sdrun() { run PATH="/tmp/sd/bin:$PATH" "$@"; }
sdrun
rc=$?
if [ "$rc" -eq 0 ] && grep -q '^restart' /tmp/sd/calls && echo "$OUT" | grep -q "Registered /record in server $guild"; then
  pass "a real run restarts the bot and sees /record registered"; else fail "restart: rc=$rc $OUT; $(cat /tmp/sd/calls)"; fi
: >/tmp/sd/calls
date -d '+1 hour' '+%F %T' >/tmp/sd/ts
sdrun
rc=$?
if [ "$rc" -eq 0 ] && ! grep -q '^restart' /tmp/sd/calls; then pass "a clean rerun leaves a newer bot alone"; else fail "clean rerun: rc=$rc $OUT; $(cat /tmp/sd/calls)"; fi
# Two players online (stand-in curl and node): the clean rerun restarts nothing, so it must not be refused; a rerun that
# does need the restart is refused and leaves the bot alone.
: >/tmp/sd/foundry
mkdir -p /opt/node24/bin
printf '#!/bin/sh\ncat >/dev/null\nprintf 2\n' >/opt/node24/bin/node
printf '#!/bin/sh\necho "{}"\n' >/tmp/sd/bin/curl
chmod +x /opt/node24/bin/node /tmp/sd/bin/curl
: >/tmp/sd/calls
sdrun
rc=$?
if [ "$rc" -eq 0 ] && ! grep -q '^restart' /tmp/sd/calls; then pass "a clean rerun is not refused while players are online"; else fail "clean rerun with players: rc=$rc $OUT; $(cat /tmp/sd/calls)"; fi
echo "2020-01-01 00:00:00 UTC" >/tmp/sd/ts
: >/tmp/sd/calls
sdrun
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'player(s) are online' && ! grep -q '^restart' /tmp/sd/calls; then pass "a rerun that needs the restart is refused while players are online"; else fail "refused rerun: rc=$rc $OUT; $(cat /tmp/sd/calls)"; fi
rm -f /tmp/sd/foundry /opt/node24/bin/node /tmp/sd/bin/curl
echo "2020-01-01 00:00:00 UTC" >/tmp/sd/ts
: >/tmp/sd/calls
sdrun
rc=$?
if [ "$rc" -eq 0 ] && grep -q '^restart' /tmp/sd/calls; then pass "a rerun after a cut-off run restarts the bot"; else fail "cut-off rerun: rc=$rc $OUT; $(cat /tmp/sd/calls)"; fi
echo "2020-01-01 00:00:00 UTC" >/tmp/sd/ts
: >/tmp/sd/calls
sdrun
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q "Registered /record in server $guild"; then
  pass "a rerun that restarts the bot checks /record again"; else fail "rerun check: rc=$rc $OUT"; fi
rm -rf /run/systemd/system /tmp/sd

# 11. UNDO rewrites only the keys the stage set.
fresh_env
run PLAYER_PAGE_URL=https://cogm.example.com/player
rc=$?
if [ "$rc" -eq 0 ] && [ -z "$(find "$TOOL_ETC" -maxdepth 1 -name '.discord-bot.env.*' 2>/dev/null)" ]; then
  pass "no temp file is left behind after a real run"; else fail "temp files: rc=$rc $(ls -a "$TOOL_ETC")"; fi
new_token="NEWtoken.rotated.after.the.stage.ran.0123456789"
sed -i "s/^DISCORD_TOKEN=.*/DISCORD_TOKEN=$new_token/" "$env_file"
echo "EXTRA_SETTING=added-later" >>"$env_file"
run UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && grep -q "^DISCORD_TOKEN=$new_token$" "$env_file" && grep -q '^EXTRA_SETTING=added-later$' "$env_file" &&
  [ "$(get DISCORD_GUILD_ID)" = "$silvera" ] && [ -z "$(get DISCORD_SESSION_POST_CHANNEL_ID)" ] && [ -z "$(get FOUNDRY_AI_PLAYER_PAGE_URL)" ] &&
  ! echo "$OUT" | grep -q "$new_token"; then
  pass "UNDO puts back only the stage's keys: a token changed since stays"; else fail "partial undo: rc=$rc $OUT"; fi

# 13. A saved copy grep cannot read: the stand-in exits 2 for that file only (root can read any file, so a real unreadable
# copy cannot be made here). UNDO must stop before any key changes.
fresh_env
run PLAYER_PAGE_URL=https://cogm.example.com/player
mkdir -p /tmp/gs/bin
real_grep="$(command -v grep)"
cat >/tmp/gs/bin/grep <<SH
#!/usr/bin/env bash
for a in "\$@"; do [ "\$a" = "$saved" ] && exit 2; done
exec $real_grep "\$@"
SH
chmod +x /tmp/gs/bin/grep
before="$(sha256sum <"$env_file")"
run PATH="/tmp/gs/bin:$PATH" UNDO=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'cannot be read by grep' && [ "$(sha256sum <"$env_file")" = "$before" ] &&
  [ -z "$(find "$TOOL_ETC" -maxdepth 1 -name '.discord-bot.env.*' 2>/dev/null)" ]; then
  pass "an unreadable saved copy stops UNDO: env file unchanged, no temp file"; else fail "unreadable saved copy: rc=$rc $OUT"; fi
rm -rf /tmp/gs

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) FAILED"; exit 1; fi
