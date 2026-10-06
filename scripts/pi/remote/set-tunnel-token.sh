#!/usr/bin/env bash
# Puts the Cloudflare Tunnel token into /etc/foundry-ai-tool/cloudflared-token (root only, 0600) and
# starts the tunnel service that stage 12 (12-tunnel.sh) installed. docs/dev/REMOTE-ACCESS.md, Part C.
#
# YOU run this, in your own SSH session; Claude never types or sees the token. It asks for the token
# on the terminal without showing it, so the token is on no command line, in no log and in no file
# except the root-only one. It stands alone (no lib.sh), so copy it over and run it with a terminal:
#   scp scripts\pi\remote\set-tunnel-token.sh foundry-pi:/tmp/set-tunnel-token.sh
#   ssh -t foundry-pi bash /tmp/set-tunnel-token.sh
# Run it again to change the token (after "Refresh token" on the tunnel's page in Cloudflare).
# Paste either the token itself or the whole install command Cloudflare shows; the last word is used.

set -euo pipefail

TOOL_ETC=/etc/foundry-ai-tool
token_file="$TOOL_ETC/cloudflared-token"
unit=foundry-ai-tool-cloudflared.service
metrics=127.0.0.1:20241

say() { printf '==> %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "run as root (the Pi's SSH login is root)"
[ -d "$TOOL_ETC" ] || die "$TOOL_ETC is missing: run stages 1 and 12 first"
[ -f "/etc/systemd/system/$unit" ] || die "$unit is missing: run stage 12 (12-tunnel.sh) first"
[ -r /dev/tty ] || die "no terminal: connect with ssh -t so the token can be typed without being shown"

say "the tunnel token"
echo "Paste the token from the Cloudflare tunnel page (it starts with eyJ) and press Enter."
echo "Nothing is shown while you paste; that is normal."
IFS= read -r -s -p "Tunnel token: " input </dev/tty
echo
# The last word: the token alone, or the end of "cloudflared service install <token>".
token="$(printf '%s' "$input" | tr -s '[:space:]' '\n' | awk 'NF { last = $0 } END { print last }')"
input=""
[ -n "$token" ] || die "nothing was entered; nothing was changed"
printf '%s' "$token" | grep -Eq '^[A-Za-z0-9+/=_-]{60,}$' ||
  die "that does not look like a tunnel token (a long run of letters and digits, no spaces); nothing was changed"
json="$(printf '%s' "$token" | base64 -d 2>/dev/null)" ||
  die "that is not a tunnel token (it is not base64); nothing was changed"
for key in a t s; do
  printf '%s' "$json" | grep -q "\"$key\"[[:space:]]*:" ||
    die "that is not a tunnel token (a tunnel token holds an account tag, a tunnel id and a secret); nothing was changed"
done
json=""

tmp="$(mktemp "$TOOL_ETC/.cloudflared-token.XXXXXX")"
trap 'rm -f "${tmp:?}"' EXIT
chmod 0600 "$tmp"
printf '%s\n' "$token" >"$tmp"
token=""
chown root:root "$tmp"
mv "$tmp" "$token_file"
trap - EXIT
ok "token written to $token_file (root only, not shown)"

say "the tunnel"
if [ ! -d /run/systemd/system ]; then
  warn "no systemd here: the token is saved, the service was not started"
  exit 0
fi
systemctl daemon-reload
systemctl enable "$unit" >/dev/null 2>&1
systemctl restart "$unit"
ready=""
for _ in $(seq 1 45); do
  ready="$(curl -fs "http://$metrics/ready" 2>/dev/null || true)"
  case "$ready" in *'"status":200'*) break ;; esac
  sleep 2
done
systemctl is-active --quiet "$unit" || die "$unit is not running; ask Claude to check: journalctl -u $unit -n 30"
case "$ready" in
  *'"status":200'*) ok "connected to Cloudflare: $ready" ;;
  *) warn "the service runs but is not connected yet (wrong token, deleted tunnel, or no outbound access); ask Claude to check: journalctl -u $unit -n 30" ;;
esac
say "done: the tunnel runs. Public hostnames and Cloudflare Access are set in the Cloudflare dashboard (docs/dev/REMOTE-ACCESS.md, Part C)"
