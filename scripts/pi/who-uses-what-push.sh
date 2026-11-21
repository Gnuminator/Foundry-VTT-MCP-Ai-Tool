#!/usr/bin/env bash
# The Pi's "Who uses what" reading (backlog who-uses-what-pi-job, stage35-board-endpoint). Installed by
# scripts/pi/remote/35-who-uses-what.sh and run by foundry-ai-tool-who-uses-what.timer (every 4 hours and Sunday 23:00). One run:
#   1. asks the Pi dashboard for the report with who-uses-what.mjs (counts and names only) and keeps the report JSON;
#   2. POSTs it to the PM board (board.spennerit.com/api/who-uses-what) the way stage 16 posts the Pi's health: over Cloudflare
#      Access with the service token in the root-only file board-status.conf, read by curl -K so it never shows in the process list.
# The Pi holds no key to the vault repo and writes no note: the board stores the reading itself. Nothing it prints holds a token.
#
# Environment (the unit sets WUW_NODE and WUW_SCRIPT from the stage; the rest are for tests):
#   WUW_NODE       the node binary; default /opt/node24/bin/node
#   WUW_SCRIPT     who-uses-what.mjs; default /opt/foundry-ai-tool/who-uses-what/who-uses-what.mjs
#   WUW_DASHBOARD  the dashboard address; default is the Pi dashboard on loopback (stage 5)
#   WUW_URL        the board endpoint; default https://board.spennerit.com/api/who-uses-what
#   WUW_CONF       the Access header file; default /etc/foundry-ai-tool/board-status.conf (root:root 0600, header lines only)
#   WUW_DAYS       the window in days; default 7
#   GM_DASHBOARD_TOKEN  from dashboard-access.env (the unit's EnvironmentFile); sent to the dashboard only
#   WUW_MODE=check  read the report and check the token file; post nothing (the stage's CHECK=1)
#   WUW_TEST=1     tests only: allows http and a token file that is not root-owned
set -euo pipefail
umask 077

node_bin="${WUW_NODE:-/opt/node24/bin/node}"
script="${WUW_SCRIPT:-/opt/foundry-ai-tool/who-uses-what/who-uses-what.mjs}"
dash="${WUW_DASHBOARD:-http://127.0.0.1:3000}"
url="${WUW_URL:-https://board.spennerit.com/api/who-uses-what}"
conf="${WUW_CONF:-/etc/foundry-ai-tool/board-status.conf}"
days="${WUW_DAYS:-7}"
test_mode="${WUW_TEST:-0}"
max_bytes=262144
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp:?}"' EXIT

say() { echo "who-uses-what: $*"; }
fail() { echo "who-uses-what: $*" >&2; exit 1; }

[ -x "$node_bin" ] || fail "node is missing at $node_bin"
[ -f "$script" ] || fail "$script is missing: run stage 35 again"
command -v curl >/dev/null 2>&1 || fail "curl is missing"

# The token file, checked on every run (a later edit must not add a curl option): not a link, root-owned 0600, and only Access
# header lines and comments. Errors name a line, never its content.
[ ! -L "$conf" ] && [ -f "$conf" ] || fail "the board token file is missing (stage 16 makes it)"
if [ "$test_mode" != 1 ] && [ "$(stat -c '%u %a' "$conf")" != "0 600" ]; then fail "the board token file must be root-owned with mode 0600"; fi
if [ -n "$(LC_ALL=C grep -a -nvE '^(header = "CF-Access-Client-(Id|Secret): [^" ]+"|#.*|)$' "$conf" | head -n 1)" ]; then
  fail "the board token file holds a line that is not an Access header (content not shown)"
fi

# The stage's CHECK gives the env file instead of the token (a token on a command line shows in the process list).
if [ -n "${WUW_ENV_FILE:-}" ] && [ -f "$WUW_ENV_FILE" ] && [ -z "${GM_DASHBOARD_TOKEN:-}" ]; then
  GM_DASHBOARD_TOKEN="$(sed -n 's/^[[:space:]]*GM_DASHBOARD_TOKEN=//p' "$WUW_ENV_FILE" | tail -n 1)"
fi

say "reading the report from the dashboard"
COGM_TOKEN="${GM_DASHBOARD_TOKEN:-}" "$node_bin" "$script" --base "$dash" --days "$days" --out "$tmp/note.md" --json "$tmp/report.json" >/dev/null ||
  fail "the dashboard gave no report (is it running, and does dashboard-access.env hold GM_DASHBOARD_TOKEN?)"
head -n 1 "$tmp/note.md" | grep -q '^# Who uses what$' || fail "the report does not look like the note (first line)"
size="$(wc -c <"$tmp/report.json")"
[ "$size" -gt 2 ] && [ "$size" -le "$max_bytes" ] || fail "the report is $size bytes (expected 3 to $max_bytes)"

if [ "${WUW_MODE:-}" = check ]; then
  say "the report is readable ($size bytes) and the board token file is in order; nothing posted"
  exit 0
fi

proto='=https'
[ "$test_mode" = 1 ] && proto='=http,https'
# -q: no ~/.curlrc. -K reads the two Access headers from the root-only file. curl's own error text never holds header values.
code="$(curl -q -sS -o "$tmp/answer" -w '%{http_code}' --proto "$proto" --max-time 30 -K "$conf" \
  -H 'Content-Type: application/json' --data-binary "@$tmp/report.json" "$url")" || fail "could not reach the board"
case "$code" in
2??) say "posted the reading to the board ($size bytes, HTTP $code)" ;;
*) fail "the board answered HTTP $code (is the board's who-uses-what endpoint deployed, and does it accept the Pi's token?)" ;;
esac
