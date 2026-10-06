#!/usr/bin/env bash
# Writes /etc/foundry-ai-tool/dashboard-access.env (the dashboard's Cloudflare Access settings and the
# GM token) and restarts the dashboard. docs/dev/REMOTE-ACCESS.md, Part C, step 10.
#
# YOU run this, in your own SSH session, AFTER the `cogm` Access application exists (you need its AUD tag)
# and AFTER stage 5 was run again (it adds the line that makes the dashboard read this file). Claude does
# not run it. It stands alone (no lib.sh), so copy it over and run it with a terminal:
#   scp scripts\pi\remote\set-dashboard-access.sh foundry-pi:/tmp/set-dashboard-access.sh
#   ssh -t foundry-pi bash /tmp/set-dashboard-access.sh
# It asks for what it needs; each can also be given as an option (--team, --aud, --emails, --host,
# --ts-name). The GM token is made here (under umask 077) and shown once, on the terminal only. An
# existing token is kept unless you add --rotate-token (the GM then opens the one-time link again).
#
# What it writes (root:foundry, 0640, replaced whole in one step):
#   CF_ACCESS_TEAM_DOMAIN  <team>.cloudflareaccess.com
#   CF_ACCESS_AUD          the cogm Access application's Application Audience tag
#   GM_EMAILS              who is the GM when they come through Cloudflare
#   DASHBOARD_ALLOWED_HOSTS  <the Pi's Tailscale name>,<cogm host>  (this file's value replaces the unit's)
#   GM_DASHBOARD_TOKEN     lets the GM in over Tailscale, where there is no Cloudflare login

set -euo pipefail
umask 077

TOOL_ETC=/etc/foundry-ai-tool
NODE_DIR=/opt/node24
FOUNDRY_USER=foundry
file="$TOOL_ETC/dashboard-access.env"
unit=foundry-ai-tool-dashboard.service

say() { printf '==> %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

team="" aud="" emails="" host="" ts_name="" rotate=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --team) team="${2:-}"; shift 2 ;;
    --aud) aud="${2:-}"; shift 2 ;;
    --emails) emails="${2:-}"; shift 2 ;;
    --host) host="${2:-}"; shift 2 ;;
    --ts-name) ts_name="${2:-}"; shift 2 ;;
    --rotate-token) rotate=1; shift ;;
    *) die "unknown option: $1 (use --team, --aud, --emails, --host, --ts-name, --rotate-token)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root (the Pi's SSH login is root)"
[ -d "$TOOL_ETC" ] || die "$TOOL_ETC is missing: run stage 1 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
[ -f "/etc/systemd/system/$unit" ] || die "$unit is missing: run stage 5 first"
grep -q "^EnvironmentFile=-$file\$" "/etc/systemd/system/$unit" ||
  die "the dashboard service does not read $file yet: run stage 5 again first (with TOOL_REF set to the build already on the Pi; see Part C, step 10)"

# True when a terminal can really be opened (the file exists even without one).
have_tty() { { : </dev/tty >/dev/tty; } 2>/dev/null; }

ask() { # ask <variable> <prompt>: asks on the terminal when the variable is still empty
  local name="$1" prompt="$2" value
  if [ -z "${!name}" ]; then
    have_tty || die "no terminal and no --${name//_/-} given: connect with ssh -t"
    IFS= read -r -p "$prompt" value </dev/tty
    printf -v "$name" '%s' "$value"
  fi
}

# The Pi's Tailscale name, if it can be read.
if [ -z "$ts_name" ] && command -v tailscale >/dev/null 2>&1 && [ -x "$NODE_DIR/bin/node" ] &&
  tailscale status >/dev/null 2>&1; then
  ts_name="$(tailscale status --json | "$NODE_DIR/bin/node" -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).Self?.DNSName||"";process.stdout.write(n.replace(/\.$/,""))})' 2>/dev/null || true)"
fi

say "the settings"
ask team "Cloudflare team name or domain (the part before .cloudflareaccess.com): "
ask aud "The cogm application's Application Audience (AUD) tag: "
ask emails "GM email addresses, separated by commas: "
ask host "The dashboard's public name (for example cogm.example.com): "
if [ -z "$ts_name" ]; then
  ask ts_name "The Pi's Tailscale name (for example foundry-pi.tail1234.ts.net; Enter to skip): "
fi

team="$(printf '%s' "$team" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/*$##')"
case "$team" in *.cloudflareaccess.com) ;; *) team="$team.cloudflareaccess.com" ;; esac
printf '%s' "$team" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$' ||
  die "the team name '$team' is not valid (letters, digits, dashes)"
aud="$(printf '%s' "$aud" | tr -d '[:space:]')"
printf '%s' "$aud" | grep -Eq '^[A-Za-z0-9]{32,128}$' ||
  die "the AUD tag must be 32 to 128 letters and digits (copy it from the application's overview page in Cloudflare)"
emails="$(printf '%s' "$emails" | tr 'A-Z' 'a-z' | tr -d '[:space:]')"
[ -n "$emails" ] || die "give at least one GM email"
IFS=',' read -r -a email_list <<<"$emails"
for e in "${email_list[@]}"; do
  printf '%s' "$e" | grep -Eq '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' || die "'$e' is not a valid email address"
done
host="$(printf '%s' "$host" | tr 'A-Z' 'a-z' | tr -d '[:space:]')"
printf '%s' "$host" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' ||
  die "'$host' is not a valid host name"
ts_name="$(printf '%s' "$ts_name" | tr 'A-Z' 'a-z' | tr -d '[:space:]')"
if [ -n "$ts_name" ]; then
  printf '%s' "$ts_name" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' || die "'$ts_name' is not a valid Tailscale name"
  hosts="$ts_name,$host"
else
  warn "no Tailscale name: the dashboard will answer only to $host (the GM's Tailscale address would show 421)"
  hosts="$host"
fi
ok "team $team, host $host, GM emails ${#email_list[@]}, allowed hosts $hosts"

say "the GM token"
token=""
if [ "$rotate" = 0 ] && [ -f "$file" ]; then
  token="$(sed -n 's/^GM_DASHBOARD_TOKEN=//p' "$file" | tail -n 1)"
fi
new_token=0
if [ -z "$token" ]; then
  token="$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
  [ "${#token}" -ge 30 ] || die "could not make a token"
  new_token=1
  ok "a new token was made (shown once, below)"
else
  ok "the existing token is kept (add --rotate-token to make a new one)"
fi

say "the settings file"
tmp="$(mktemp "$TOOL_ETC/.dashboard-access.env.XXXXXX")"
trap 'rm -f "${tmp:?}"' EXIT
{
  echo "# Written by scripts/pi/remote/set-dashboard-access.sh; run it again to change this (the file is replaced whole)."
  echo "# Read by the dashboard service after dashboard.env. Holds the GM token: root and the foundry group only."
  echo "CF_ACCESS_TEAM_DOMAIN=$team"
  echo "CF_ACCESS_AUD=$aud"
  echo "GM_EMAILS=$emails"
  echo "DASHBOARD_ALLOWED_HOSTS=$hosts"
  echo "GM_DASHBOARD_TOKEN=$token"
} >"$tmp"
chown "root:$FOUNDRY_USER" "$tmp"
chmod 0640 "$tmp"
mv "$tmp" "$file"
trap - EXIT
ok "$file written (root:$FOUNDRY_USER, 0640)"

say "the dashboard"
if [ ! -d /run/systemd/system ]; then
  warn "no systemd here: the file is written, the dashboard was not restarted"
else
  systemctl restart "$unit"
  up=0
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null -H "Host: $host" http://127.0.0.1:3000/; then up=1; break; fi
    sleep 1
  done
  systemctl is-active --quiet "$unit" || die "$unit is not running; ask Claude to check: journalctl -u $unit -n 30"
  [ "$up" = 1 ] || warn "the dashboard has not answered yet; ask Claude to check: journalctl -u $unit -n 30"
  code_ok="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $host" http://127.0.0.1:3000/ || true)"
  code_bad="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: not-listed.example" http://127.0.0.1:3000/ || true)"
  if [ "$code_ok" != 421 ] && [ "$code_bad" = 421 ]; then
    ok "the dashboard answers to $host ($code_ok) and refuses other names (421)"
  else
    warn "host check unexpected: $host gave $code_ok, an unlisted name gave $code_bad (expected not 421, and 421)"
  fi
fi

if [ "$new_token" = 1 ]; then
  say "the GM's one-time link (shown only here; not saved anywhere else)"
  if have_tty; then
    {
      echo
      echo "  Give the GM this link, to open once in his browser over Tailscale:"
      if [ -n "$ts_name" ]; then
        echo "    http://$ts_name:3000/?token=$token"
      else
        echo "    http://<the Pi's Tailscale name>:3000/?token=$token"
      fi
      echo "  The browser remembers it and takes the token out of the address bar."
      echo "  It is also in $file (root and the foundry group can read it)."
      echo
    } >/dev/tty
  else
    warn "no terminal to show the token on; read it with: grep GM_DASHBOARD_TOKEN $file"
  fi
fi
say "done. Next: add the cogm route in the Cloudflare tunnel (Part C, step 10 in detail, part 4)"
